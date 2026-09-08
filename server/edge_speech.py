"""Read one JSON request on stdin and emit MP3 bytes on stdout.

The Node server owns the request timeout and kills this process on cancellation.
No audio or user text is written to disk. Failed attempts discard partial audio.
"""
import asyncio
import json
import sys

import edge_tts


async def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    for attempt in range(2):
        try:
            audio = bytearray()
            communication = edge_tts.Communicate(
                payload["text"], payload["voice"],
                rate=f'{payload["rate"] * 6:+d}%',
                connect_timeout=10, receive_timeout=20,
            )
            async for chunk in communication.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                    if len(audio) > 16_000_000:
                        raise ValueError("Audio too large")
            if not audio:
                raise ValueError("Empty audio")
            sys.stdout.buffer.write(audio)
            sys.stdout.buffer.flush()
            return
        except Exception:
            if attempt:
                # Avoid writing request content or proxy credentials to logs.
                print("Edge-TTS synthesis failed", file=sys.stderr)
                raise SystemExit(1)
            await asyncio.sleep(0.4)


if __name__ == "__main__":
    asyncio.run(main())
