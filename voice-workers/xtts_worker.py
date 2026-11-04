"""Gera a fala com o XTTS v2 usando os latentes de uma voz (ex.: voz-maidzinha-latentes.pt)."""
import argparse
import logging
import os
import re
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from common import exit_with_parent, serve, setup_log  # noqa: E402

RATE = 24000
PAUSE_SECONDS = 0.15
MAX_CHARS = 180  # o XTTS corta frases muito longas em português


def pieces(text):
    """Divide em frases e quebra as longas em vírgulas ou espaços."""
    out = []
    for sentence in re.findall(r"[^.!?…]+[.!?…]*", text) or [text]:
        sentence = sentence.strip()
        while len(sentence) > MAX_CHARS:
            cut = max(sentence.rfind(",", 0, MAX_CHARS), sentence.rfind(" ", 0, MAX_CHARS))
            cut = cut if cut > 40 else MAX_CHARS
            out.append(sentence[: cut + 1].strip())
            sentence = sentence[cut + 1 :].strip()
        if re.search(r"\w", sentence):
            out.append(sentence)
    return out


class Voice:
    def __init__(self, args):
        import torch
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        start = time.time()
        self.torch = torch
        self.language = args.language
        self.temperature = args.temperature
        self.speed = args.speed
        device = args.device
        if device != "cpu" and not torch.cuda.is_available():
            logging.info("CUDA indisponível; usando o processador")
            device = "cpu"
        self.on_demand = device == "on-demand"
        config = XttsConfig()
        config.load_json(os.path.join(args.model_dir, "config.json"))
        self.model = Xtts.init_from_config(config)
        self.model.load_checkpoint(config, checkpoint_dir=args.model_dir, use_deepspeed=False, eval=True)
        latents = torch.load(args.latents, map_location="cpu", weights_only=True)
        self.gpt, self.speaker = latents["gpt"], latents["speaker"]
        self.place("cpu" if device in ("cpu", "on-demand") else "cuda")
        self.lock = threading.Lock()
        logging.info("xtts pronto em %.1fs (%s)", time.time() - start, device)

    def place(self, device):
        self.model.to(device)
        self.gpt = self.gpt.to(device)
        self.speaker = self.speaker.to(device)
        if device == "cpu" and self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()

    def say(self, body):
        import numpy as np
        import soundfile as sf

        text, path = body["text"], body["path"]
        start = time.time()
        pause = np.zeros(int(RATE * PAUSE_SECONDS), dtype=np.float32)
        audio = []
        with self.lock:
            if self.on_demand:
                self.place("cuda")
            try:
                for part in pieces(text):
                    result = self.model.inference(
                        part, self.language, self.gpt, self.speaker,
                        temperature=self.temperature, speed=self.speed,
                    )
                    audio += [np.asarray(result["wav"], dtype=np.float32), pause]
            finally:
                if self.on_demand:
                    self.place("cpu")
        if not audio:
            raise ValueError("texto sem conteúdo para falar")
        sf.write(path, np.concatenate(audio[:-1]), RATE, subtype="PCM_16")
        logging.info("%d caracteres em %.1fs", len(text), time.time() - start)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--parent-pid", type=int, required=True)
    p.add_argument("--model-dir", required=True)
    p.add_argument("--latents", required=True)
    p.add_argument("--language", default="pt")
    p.add_argument("--device", default="cuda", choices=["cuda", "cpu", "on-demand"])
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--log", required=True)
    args = p.parse_args()
    setup_log(args.log)
    exit_with_parent(args.parent_pid)
    voice = Voice(args)
    serve(args.port, {"/say": voice.say})


if __name__ == "__main__":
    main()
