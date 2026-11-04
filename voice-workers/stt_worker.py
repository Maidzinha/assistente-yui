"""Transcreve a fala do microfone com o faster-whisper (local, sem internet depois do primeiro uso)."""
import argparse
import logging
import os
import sys
import threading
import time

WORKERS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKERS)

from common import exit_with_parent, serve, setup_log  # noqa: E402


def read_wav_16k(path):
    """Lê o WAV PCM 16 bits do app (16 kHz mono) sem depender do PyAV/ffmpeg."""
    import wave

    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("o áudio precisa ser WAV PCM de 16 bits")
        rate, channels = w.getframerate(), w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    if rate != 16000:
        n = int(len(data) * 16000 / rate)
        data = np.interp(np.linspace(0, len(data) - 1, n), np.arange(len(data)), data).astype(np.float32)
    return data


class Ouvido:
    def __init__(self, args):
        from faster_whisper import WhisperModel

        start = time.time()
        compute = "int8" if args.device == "cpu" else "int8_float16"
        try:
            # Usa o modelo já baixado; só vai à internet se ele ainda não existir.
            self.model = WhisperModel(args.model, device=args.device, compute_type=compute, local_files_only=True)
        except Exception:
            logging.info("baixando o modelo %s pela primeira vez", args.model)
            self.model = WhisperModel(args.model, device=args.device, compute_type=compute)
        self.lock = threading.Lock()
        logging.info("whisper %s pronto em %.1fs (%s)", args.model, time.time() - start, args.device)

    def transcribe(self, body):
        start = time.time()
        audio = read_wav_16k(body["path"])
        with self.lock:
            segments, _ = self.model.transcribe(
                audio,
                language=body.get("language") or None,
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        logging.info("transcrito em %.1fs (%d caracteres)", time.time() - start, len(text))
        return {"text": text}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--parent-pid", type=int, required=True)
    p.add_argument("--model", default="small")
    p.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    p.add_argument("--log", required=True)
    args = p.parse_args()
    setup_log(args.log)
    exit_with_parent(args.parent_pid)
    ouvido = Ouvido(args)
    serve(args.port, {"/transcribe": ouvido.transcribe})


if __name__ == "__main__":
    main()
