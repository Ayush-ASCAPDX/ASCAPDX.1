"""
Jarvis PC Assistant — Minimal MVP (Python)

Features:
- Wake-word style: says "Jarvis" + command (e.g., "Jarvis open Chrome").
- Offline speech-to-text via Vosk (lightweight, works without internet).
- Text-to-speech via pyttsx3 (cross-platform).
- Basic PC controls: open apps/sites, type text, media keys, volume, window control.
- Safety confirmations for risky actions (shutdown, sign-out, etc.).

Setup (one-time):
1) Install Python 3.10+ (64-bit recommended).
2) pip install -r requirements.txt (example: vosk, sounddevice, pyttsx3, pyautogui, pynput, psutil)
3) Download a Vosk model (small English works fine):
   https://alphacephei.com/vosk/models   (e.g., vosk-model-small-en-us-0.15)
   Unzip it and set VOSK_MODEL_PATH below to the folder path.
4) On Windows, allow microphone access in Privacy settings.

Run:
python assistant.py

Say commands like:
- "Jarvis open notepad"
- "Jarvis search for quantum computing"
- "Jarvis type Hello world"
- "Jarvis mute volume" / "Jarvis volume up" / "Jarvis volume down"
- "Jarvis pause" / "Jarvis play"
- "Jarvis new tab"
- "Jarvis close window"
- "Jarvis lock computer" (will ask to confirm)
- "Jarvis shutdown" (will ask to confirm)

Note: This is a minimal starter. Extend intents as you like.
"""

import json
import os
import platform
import queue
import re
import subprocess
import sys
import threading
import time
import webbrowser
from dataclasses import dataclass
from typing import Callable, Dict, Optional

VOSK_MODEL_PATH = "vosk-model-small-en-in-0.4",

# --- Third-party deps ---
# Make sure to install: vosk, sounddevice, pyttsx3, pyautogui, pynput, psutil
try:
    import sounddevice as sd
    from vosk import Model, KaldiRecognizer
    import pyttsx3
    import pyautogui
    from pynput.keyboard import Controller as KBController, Key
    import psutil
except Exception as e:
    print("Missing dependency:", e)
    print("Run: pip install vosk sounddevice pyttsx3 pyautogui pynput psutil")
    sys.exit(1)

# ---------- Configuration ----------
WAKE_WORD = "jarvis"
LANG = "en"

# Set your local Vosk model folder path here
VOSK_MODEL_PATH = os.environ.get("VOSK_MODEL_PATH", r"./vosk-model-small-en-us-0.15")

# App shortcuts you want Jarvis to know
APP_ALIASES = {
    "notepad": r"notepad" if platform.system() == "Windows" else "gedit",
    "chrome": r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" if platform.system()=="Windows" else "google-chrome",
    "vscode": r"Code" if platform.system()=="Windows" else "code",
}

# ---------- TTS ----------
class Speaker:
    def __init__(self):
        self.engine = pyttsx3.init()
        # Optional voice tuning
        rate = self.engine.getProperty('rate')
        self.engine.setProperty('rate', int(rate*0.95))

    def say(self, text: str):
        self.engine.say(text)
        self.engine.runAndWait()

speaker = Speaker()

# ---------- STT (Vosk streaming) ----------
if not os.path.isdir(VOSK_MODEL_PATH):
    print(f"Vosk model folder not found at: {VOSK_MODEL_PATH}")
    print("Download models from https://alphacephei.com/vosk/models and set VOSK_MODEL_PATH.")
    sys.exit(1)

model = Model(VOSK_MODEL_PATH)
rec = KaldiRecognizer(model, 16000)
rec.SetWords(False)

audio_q: "queue.Queue[bytes]" = queue.Queue()


def audio_callback(indata, frames, time_info, status):
    if status:
        print(status, file=sys.stderr)
    # Convert to 16k mono PCM bytes expected by Vosk
    audio_q.put(bytes(indata))


# ---------- Intent Handling ----------
keyboard = KBController()

@dataclass
class Intent:
    name: str
    func: Callable[[str], None]
    pattern: re.Pattern


def respond(text: str):
    print("Jarvis:", text)
    speaker.say(text)


def confirm(prompt: str) -> bool:
    respond(prompt + " Say yes to confirm.")
    # Simple 4-second window to catch a quick "yes"
    end = time.time() + 4
    heard_yes = False
    while time.time() < end:
        try:
            chunk = audio_q.get_nowait()
        except queue.Empty:
            time.sleep(0.05)
            continue
        if rec.AcceptWaveform(chunk):
            res = json.loads(rec.Result()).get("text", "")
            if "yes" in res.lower():
                heard_yes = True
                break
    return heard_yes


# ---- Utility actions ----

def open_app(target: str):
    # target e.g. "notepad", "chrome"
    exe = APP_ALIASES.get(target.lower(), target)
    try:
        if platform.system() == "Windows":
            subprocess.Popen(exe if exe.endswith('.exe') or \
                                  os.path.split(exe)[-1].endswith('.exe') else exe)
        else:
            subprocess.Popen([exe])
        respond(f"Opening {target}.")
    except Exception as e:
        respond(f"I couldn't open {target}: {e}")


def search_web(query: str):
    webbrowser.open(f"https://www.google.com/search?q={query}")
    respond(f"Searching for {query}.")


def open_site(url_or_query: str):
    if re.match(r"^https?://", url_or_query):
        webbrowser.open(url_or_query)
    else:
        # assume domain
        webbrowser.open(f"https://{url_or_query}")
    respond(f"Opening {url_or_query}.")


def type_text(text: str):
    pyautogui.typewrite(text)
    respond("Typed.")


def media_key(action: str):
    key_map = {
        "play": Key.media_play_pause,
        "pause": Key.media_play_pause,
        "next": Key.media_next,
        "previous": Key.media_previous,
        "mute": Key.media_volume_mute,
        "volume up": Key.media_volume_up,
        "volume down": Key.media_volume_down,
    }
    k = key_map.get(action)
    if not k:
        respond("Unsupported media action.")
        return
    keyboard.press(k)
    keyboard.release(k)
    respond(action.capitalize())


def window_action(action: str):
    if platform.system() == "Windows":
        if action == "close":
            pyautogui.hotkey('alt', 'f4')
        elif action == "minimize":
            pyautogui.hotkey('win', 'down')
        elif action == "maximize":
            pyautogui.hotkey('win', 'up')
        elif action == "new tab":
            pyautogui.hotkey('ctrl', 't')
        elif action == "close tab":
            pyautogui.hotkey('ctrl', 'w')
        else:
            respond("Window action not supported.")
            return
        respond(f"{action.capitalize()}.")
    else:
        respond("Window actions are currently configured for Windows.")


def system_action(action: str):
    act = action.lower()
    if act in ["shutdown", "power off"]:
        if confirm("Do you really want to shut down?"):
            if platform.system() == "Windows":
                os.system("shutdown /s /t 0")
            elif platform.system() == "Darwin":
                os.system("osascript -e 'tell app \"System Events\" to shut down'")
            else:
                os.system("shutdown now")
        else:
            respond("Cancelled.")
    elif act in ["restart", "reboot"]:
        if confirm("Do you really want to restart?"):
            if platform.system() == "Windows":
                os.system("shutdown /r /t 0")
            elif platform.system() == "Darwin":
                os.system("osascript -e 'tell app \"System Events\" to restart'")
            else:
                os.system("reboot")
        else:
            respond("Cancelled.")
    elif act in ["lock", "lock computer"]:
        if platform.system() == "Windows":
            os.system("rundll32.exe user32.dll,LockWorkStation")
        elif platform.system() == "Darwin":
            os.system("/System/Library/CoreServices/Menu\ Extras/User.menu/Contents/Resources/CGSession -suspend")
        else:
            os.system("loginctl lock-session")
        respond("Locked.")
    else:
        respond("Unsupported system action.")


# ---- Intents ----
INTENTS: Dict[str, Intent] = {}


def intent(pattern: str):
    compiled = re.compile(pattern, re.I)
    def wrapper(fn: Callable[[str], None]):
        INTENTS[fn.__name__] = Intent(fn.__name__, fn, compiled)
        return fn
    return wrapper


@intent(r"(?:open|launch)\s+([\w .-]+)")
def intent_open_app(cmd: str):
    m = INTENTS['intent_open_app'].pattern.search(cmd)
    if not m: return
    target = m.group(1).strip()
    open_app(target)


@intent(r"(?:search for|google|find)\s+(.+)")
def intent_search(cmd: str):
    m = INTENTS['intent_search'].pattern.search(cmd)
    if not m: return
    query = m.group(1).strip()
    search_web(query)


@intent(r"(?:open|go to|visit)\s+((?:https?://)?[\w.-]+(?:\.[a-z]{2,})(?:/\S*)?)")
def intent_open_site(cmd: str):
    m = INTENTS['intent_open_site'].pattern.search(cmd)
    if not m: return
    target = m.group(1).strip()
    open_site(target)


@intent(r"(?:type|write)\s+(.+)")
def intent_type(cmd: str):
    m = INTENTS['intent_type'].pattern.search(cmd)
    if not m: return
    text = m.group(1)
    type_text(text)


@intent(r"(play|pause|next|previous|mute|volume up|volume down)")
def intent_media(cmd: str):
    m = INTENTS['intent_media'].pattern.search(cmd)
    if not m: return
    action = m.group(1).lower()
    media_key(action)


@intent(r"(close|minimize|maximize|new tab|close tab)\b")
def intent_window(cmd: str):
    m = INTENTS['intent_window'].pattern.search(cmd)
    if not m: return
    action = m.group(1).lower()
    window_action(action)


@intent(r"(shutdown|power off|restart|reboot|lock|lock computer)")
def intent_system(cmd: str):
    m = INTENTS['intent_system'].pattern.search(cmd)
    if not m: return
    action = m.group(1).lower()
    system_action(action)


# ---------- Main Loop ----------

def parse_and_dispatch(text: str):
    # Remove wake word prefix
    lowered = text.lower().strip()
    if lowered.startswith(WAKE_WORD):
        lowered = lowered[len(WAKE_WORD):].strip(",. :;")
    # match intents
    for it in INTENTS.values():
        if it.pattern.search(lowered):
            it.func(lowered)
            return True
    return False


def listen_loop():
    respond("Jarvis online. Say 'Jarvis' followed by a command.")
    with sd.RawInputStream(samplerate=16000, blocksize=8000, dtype='int16', channels=1, callback=audio_callback):
        partial = ""
        while True:
            data = audio_q.get()
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                text = result.get("text", "")
                if not text:
                    continue
                print("You:", text)
                if WAKE_WORD in text.lower():
                    # Everything after the wake word will be parsed for intent
                    if not parse_and_dispatch(text):
                        respond("I heard you, but didn't catch the command.")
            else:
                # You can optionally inspect partial results
                _p = json.loads(rec.PartialResult()).get("partial", "")
                if _p:
                    partial = _p


if __name__ == "__main__":
    try:
        listen_loop()
    except KeyboardInterrupt:
        print("\nExiting...")
