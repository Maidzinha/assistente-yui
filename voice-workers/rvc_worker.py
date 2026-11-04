"""Aplica o timbre de um modelo RVC (ex.: maidzinha_e255_s15555.pth) sobre a fala do XTTS."""
import argparse
import logging
import os
import sys
import threading
import time

WORKERS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKERS)

from common import exit_with_parent, serve, setup_log  # noqa: E402


class Timbre:
    def __init__(self, args):
        rvc = args.rvc_dir
        os.chdir(rvc)
        sys.path.insert(0, rvc)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        if args.device == "cpu":
            # Deixa a placa de vídeo livre para a IA e o XTTS.
            os.environ["CUDA_VISIBLE_DEVICES"] = ""
        os.environ["weight_root"] = os.path.dirname(args.model)
        os.environ["index_root"] = os.path.dirname(args.index) if args.index else os.path.join(rvc, "logs")
        os.environ["outside_index_root"] = os.path.join(rvc, "assets", "indices")
        os.environ["rmvpe_root"] = os.path.join(rvc, "assets", "rmvpe")

        from configs.config import Config
        from infer.vc.modules import VC

        start = time.time()
        argv, sys.argv = sys.argv, sys.argv[:1]  # o Config do RVC lê a linha de comando
        config = Config()
        sys.argv = argv
        self.vc = VC(config)
        self.vc.get_vc(os.path.basename(args.model))
        self.args = args
        self.lock = threading.Lock()
        warmup = os.path.join(rvc, "logs", "mute", "1_16k_wavs", "mute.wav")
        if os.path.exists(warmup):
            # Carrega o HuBERT agora para a primeira fala não pagar por isso.
            self.vc.vc_single(0, warmup, 0, args.f0, args.index or "", args.index_rate, 0, 1.0, args.protect)
        logging.info("rvc pronto em %.1fs (%s)", time.time() - start, config.device)

    def convert(self, body):
        import soundfile as sf

        a = self.args
        start = time.time()
        with self.lock:
            status, result = self.vc.vc_single(
                0, body["input"], a.pitch, a.f0, a.index or "", a.index_rate, 0, 1.0, a.protect
            )
        if not result or result[0] is None:
            raise RuntimeError(status)
        sf.write(body["output"], result[1], result[0], subtype="PCM_16")
        logging.info("convertido em %.1fs", time.time() - start)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--parent-pid", type=int, required=True)
    p.add_argument("--rvc-dir", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--index", default="")
    p.add_argument("--pitch", type=int, default=3)
    p.add_argument("--f0", default="rmvpe", choices=["rmvpe", "pm"])
    p.add_argument("--index-rate", type=float, default=0.5)
    p.add_argument("--protect", type=float, default=0.33)
    p.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    p.add_argument("--log", required=True)
    args = p.parse_args()
    setup_log(args.log)
    exit_with_parent(args.parent_pid)
    timbre = Timbre(args)
    serve(args.port, {"/convert": timbre.convert})


if __name__ == "__main__":
    main()
