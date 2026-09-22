"""UI strings for the Learn tab per output language. A few languages are built in; any other is
translated once by the text model and cached in data/learn_i18n.json."""
import json
import threading
from pathlib import Path
from typing import Any

from . import openrouter

FILE = Path(__file__).resolve().parent.parent / "data" / "learn_i18n.json"
_lock = threading.Lock()

BASE: dict[str, Any] = {
    "intro": "Ask anything about System One models, Jev, Laya, the three question types, confidence, or the design patterns, in any language. I answer in your language, only from the documents in the hub, and cite them.",
    "placeholder": "Ask about System One, Jev or Laya…",
    "starters": [
        "What is a System One model and how is it different from an LLM?",
        "When should I use choice vs score vs noul?",
        "How do I structure the state for a support ticket?",
        "Explain confidence-gated routing with an example.",
        "What is speculative fan-out?",
        "How does Laya differ from Jev?",
    ],
}

BUILTIN: dict[str, dict[str, Any]] = {
    "English": BASE,
    "Burmese": {
        "intro": "System One မော်ဒယ်များ၊ Jev၊ Laya၊ မေးခွန်းအမျိုးအစား သုံးမျိုး၊ ယုံကြည်မှုအဆင့် (confidence) သို့မဟုတ် ဒီဇိုင်းပုံစံများအကြောင်း ဘာသာစကားမရွေး မေးနိုင်ပါသည်။ ကျွန်ုပ်သည် သင့်ဘာသာစကားဖြင့် hub ထဲရှိ စာရွက်စာတမ်းများမှသာ ဖြေကြားပြီး ရင်းမြစ်များကို ကိုးကားပေးပါမည်။",
        "placeholder": "System One၊ Jev သို့မဟုတ် Laya အကြောင်း မေးပါ…",
        "starters": [
            "System One မော်ဒယ်ဆိုတာ ဘာလဲ၊ LLM နဲ့ ဘာကွာသလဲ။",
            "choice၊ score နဲ့ noul ကို ဘယ်အချိန်မှာ သုံးသင့်သလဲ။",
            "support ticket အတွက် state ကို ဘယ်လို တည်ဆောက်ရမလဲ။",
            "confidence-gated routing ကို ဥပမာနဲ့ ရှင်းပြပါ။",
            "speculative fan-out ဆိုတာ ဘာလဲ။",
            "Laya နဲ့ Jev ဘာကွာသလဲ။",
        ],
    },
    "Thai": {
        "intro": "ถามอะไรก็ได้เกี่ยวกับโมเดล System One, Jev, Laya, คำถามสามประเภท, ความมั่นใจ (confidence) หรือรูปแบบการออกแบบ ในภาษาใดก็ได้ ฉันจะตอบเป็นภาษาของคุณ จากเอกสารใน hub เท่านั้น พร้อมอ้างอิงแหล่งที่มา",
        "placeholder": "ถามเกี่ยวกับ System One, Jev หรือ Laya…",
        "starters": ["โมเดล System One คืออะไร และต่างจาก LLM อย่างไร?", "ควรใช้ choice, score หรือ noul เมื่อไหร่?", "ควรจัดโครงสร้าง state สำหรับ support ticket อย่างไร?", "อธิบาย confidence-gated routing พร้อมตัวอย่าง", "speculative fan-out คืออะไร?", "Laya ต่างจาก Jev อย่างไร?"],
    },
    "Chinese (Simplified)": {
        "intro": "可以用任何语言询问关于 System One 模型、Jev、Laya、三种问题类型、置信度或设计模式的任何问题。我会用你的语言、仅根据知识库中的文档作答，并注明出处。",
        "placeholder": "询问关于 System One、Jev 或 Laya 的问题…",
        "starters": ["什么是 System One 模型？它与 LLM 有何不同？", "什么时候该用 choice、score 或 noul？", "支持工单的 state 应该如何组织？", "举例说明 confidence-gated routing。", "什么是 speculative fan-out？", "Laya 和 Jev 有什么区别？"],
    },
    "Japanese": {
        "intro": "System One モデル、Jev、Laya、3つの質問タイプ、confidence、デザインパターンについて、どの言語でも質問できます。あなたの言語で、ハブ内のドキュメントのみに基づいて出典付きで回答します。",
        "placeholder": "System One、Jev、Laya について質問…",
        "starters": ["System One モデルとは何ですか？LLM との違いは？", "choice、score、noul はいつ使い分けますか？", "サポートチケットの state はどう構成しますか？", "confidence-gated routing を例で説明してください。", "speculative fan-out とは何ですか？", "Laya と Jev の違いは？"],
    },
    "Spanish": {
        "intro": "Pregunta lo que quieras sobre los modelos System One, Jev, Laya, los tres tipos de pregunta, la confianza o los patrones de diseño, en cualquier idioma. Respondo en tu idioma, solo a partir de los documentos del hub, y cito las fuentes.",
        "placeholder": "Pregunta sobre System One, Jev o Laya…",
        "starters": ["¿Qué es un modelo System One y en qué se diferencia de un LLM?", "¿Cuándo debo usar choice, score o noul?", "¿Cómo estructuro el state para un ticket de soporte?", "Explica el confidence-gated routing con un ejemplo.", "¿Qué es el speculative fan-out?", "¿En qué se diferencia Laya de Jev?"],
    },
}

CHAT_BASE: dict[str, Any] = {
    "intro": "Hi! Tell me what you want to decide and paste the text, in any language. I will turn it into typed questions, run the decision model, and explain the result.",
    "placeholder": "Describe what to decide and paste the text…  (Enter to send, Shift+Enter for newline)",
    "starters": [
        "Is this support email urgent, and which team should handle it? \"Hi, we were billed twice for March. Refund it today or we cancel.\"",
        "Rate how positive this review is, 0 to 4: \"Great battery, awful screen.\"",
        "Does this message contain a threat to leave? \"If this happens again I am switching providers.\"",
        "Classify this message as complaint / praise / question: \"Your app is great, thank you!\"",
    ],
}

CHAT_BUILTIN: dict[str, dict[str, Any]] = {
    "English": CHAT_BASE,
    "Burmese": {
        "intro": "မင်္ဂလာပါ။ ဘာကို ဆုံးဖြတ်ချင်သလဲ ပြောပြပြီး စာသားကို ကူးထည့်ပါ၊ ဘာသာစကား မရွေးပါ။ ကျွန်ုပ်က မေးခွန်းအမျိုးအစားများအဖြစ် ပြောင်းပြီး ဆုံးဖြတ်မော်ဒယ်ကို run ကာ ရလဒ်ကို ရှင်းပြပေးပါမည်။",
        "placeholder": "ဘာဆုံးဖြတ်ချင်သလဲ ရေးပြီး စာသားကို ကူးထည့်ပါ…  (Enter = ပို့ရန်၊ Shift+Enter = လိုင်းအသစ်)",
        "starters": [
            "ဒီ support email က အရေးကြီးသလား၊ ဘယ်အဖွဲ့က ကိုင်တွယ်သင့်သလဲ။ \"မတ်လအတွက် နှစ်ကြိမ်ငွေဖြတ်ထားပါတယ်၊ ဒီနေ့ပြန်အမ်းပါ မဟုတ်ရင် ရပ်မယ်။\"",
            "ဒီ review က ဘယ်လောက်အပြုသဘောဆောင်သလဲ၊ ၀ မှ ၄ အထိ အမှတ်ပေးပါ။ \"ဘက်ထရီကောင်းတယ်၊ မျက်နှာပြင်ဆိုးတယ်။\"",
            "ဒီစာထဲမှာ ထွက်ခွာမယ်ဆိုတဲ့ ခြိမ်းခြောက်မှု ပါသလား။ \"နောက်တစ်ခါ ဒီလိုဖြစ်ရင် တခြားကို ပြောင်းမယ်။\"",
            "ဒီစာကို တိုင်ကြားချက် / ချီးကျူးစကား / မေးခွန်း အဖြစ် ခွဲပေးပါ။ \"မင်းတို့ app က အရမ်းကောင်းတယ်၊ ကျေးဇူးပါ!\"",
        ],
    },
    "Thai": {
        "intro": "สวัสดี! บอกฉันว่าคุณต้องการตัดสินใจอะไรและวางข้อความ ในภาษาใดก็ได้ ฉันจะแปลงเป็นคำถามแบบมีชนิด รันโมเดลตัดสินใจ และอธิบายผลลัพธ์",
        "placeholder": "อธิบายสิ่งที่ต้องการตัดสินใจและวางข้อความ…  (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)",
        "starters": [
            "อีเมลซัพพอร์ตนี้เร่งด่วนไหม และทีมไหนควรรับผิดชอบ? \"เราถูกเรียกเก็บเงินซ้ำสองครั้งสำหรับเดือนมีนาคม คืนเงินวันนี้ไม่งั้นเราจะยกเลิก\"",
            "ให้คะแนนความเป็นบวกของรีวิวนี้ 0 ถึง 4: \"แบตดีมาก แต่จอแย่\"",
            "ข้อความนี้มีการขู่ว่าจะเลิกใช้ไหม? \"ถ้าเกิดแบบนี้อีก ฉันจะย้ายไปเจ้าอื่น\"",
            "จัดประเภทข้อความนี้เป็น ร้องเรียน / ชื่นชม / คำถาม: \"แอปของคุณดีมาก ขอบคุณ!\"",
        ],
    },
}

TRANSLATE_PROMPT = """Translate the JSON values below into {lang} (native script). Keep the keys unchanged, keep the
same number of starters, and keep technical terms exactly as they are: System One, Jev, Laya, LLM,
choice, score, noul, confidence, confidence-gated routing, speculative fan-out, state, hub.
Quoted example texts inside starters should be translated too (natural, colloquial), keeping the quotes.
Respond with ONLY the translated JSON object."""


def _cache(scope: str = "learn") -> dict[str, Any]:
    try:
        return (json.loads(FILE.read_text()) if FILE.exists() else {}).get(scope, {}) if FILE.exists() else {}
    except Exception:
        return {}


def _cache_all() -> dict[str, Any]:
    try:
        return json.loads(FILE.read_text()) if FILE.exists() else {}
    except Exception:
        return {}


def _unused():
    try:
        return json.loads(FILE.read_text()) if FILE.exists() else {}
    except Exception:
        return {}


async def strings(lang: str | None, scope: str = "learn") -> dict[str, Any]:
    base, builtin = (CHAT_BASE, CHAT_BUILTIN) if scope == "chat" else (BASE, BUILTIN)
    if not lang or lang == "Auto" or lang in builtin:
        return {"lang": lang or "Auto", "cached": True, **builtin.get(lang or "", base)}
    c = _cache(scope)
    if lang in c:
        return {"lang": lang, "cached": True, **c[lang]}
    if not openrouter.get_openrouter_key():
        return {"lang": lang, "cached": False, "fallback": True, **base}
    try:
        out = await openrouter.chat_messages(
            [{"role": "system", "content": TRANSLATE_PROMPT.format(lang=lang)}, {"role": "user", "content": json.dumps(base, ensure_ascii=False)}],
            purpose="i18n", json_mode=True, temperature=0,
        )
        data = {"intro": str(out.get("intro") or base["intro"]), "placeholder": str(out.get("placeholder") or base["placeholder"]),
                "starters": [str(x) for x in (out.get("starters") or base["starters"])][: len(base["starters"])]}
    except Exception:
        return {"lang": lang, "cached": False, "fallback": True, **base}
    with _lock:
        allc = _cache_all()
        allc.setdefault(scope, {})[lang] = data
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps(allc, ensure_ascii=False, indent=1))
    return {"lang": lang, "cached": False, **data}


# ---------------------------------------------------------------- pre-translate everything (background)
import asyncio

ALL_LANGUAGES: list[str] = ['Auto', 'English', 'Burmese', 'Thai', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Japanese', 'Korean', 'Vietnamese', 'Indonesian', 'Malay', 'Filipino', 'Khmer', 'Lao', 'Shan', 'Mon', 'Karen (S\\', 'Hindi', 'Bengali', 'Urdu', 'Punjabi', 'Gujarati', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Nepali', 'Tibetan', 'Mongolian', 'Arabic', 'Persian', 'Hebrew', 'Turkish', 'Kurdish', 'Azerbaijani', 'Kazakh', 'Uzbek', 'Georgian', 'Armenian', 'Russian', 'Ukrainian', 'Polish', 'Czech', 'Slovak', 'Hungarian', 'Romanian', 'Bulgarian', 'Serbian', 'Croatian', 'Bosnian', 'Slovenian', 'Macedonian', 'Albanian', 'Greek', 'Lithuanian', 'Latvian', 'Estonian', 'Finnish', 'Swedish', 'Norwegian', 'Danish', 'Icelandic', 'German', 'Dutch', 'French', 'Spanish', 'Catalan', 'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Italian', 'Irish', 'Welsh', 'Swahili', 'Amharic', 'Hausa', 'Yoruba', 'Igbo', 'Zulu', 'Xhosa', 'Afrikaans', 'Somali', 'Malagasy', 'Haitian Creole', 'Esperanto', 'Latin']

_warm: dict[str, Any] = {"running": False, "done": 0, "total": 0, "current": None, "errors": 0}


def warm_status() -> dict[str, Any]:
    cached = _cache_all()
    have = {sc: len(cached.get(sc, {})) + len(b) for sc, b in (("learn", BUILTIN), ("chat", CHAT_BUILTIN))}
    return {**_warm, "have": have, "languages": len(ALL_LANGUAGES)}


async def warm_all() -> None:
    """Translate UI strings for every language in both scopes, skipping what is cached. One call each."""
    if _warm["running"]:
        return
    todo = [(sc, l) for sc in ("learn", "chat") for l in ALL_LANGUAGES
            if l not in (BUILTIN if sc == "learn" else CHAT_BUILTIN) and l not in _cache(sc)]
    _warm.update(running=True, done=0, total=len(todo), errors=0)
    try:
        for sc, l in todo:
            _warm["current"] = f"{sc}:{l}"
            r = await strings(l, sc)
            if r.get("fallback"):
                _warm["errors"] += 1
            _warm["done"] += 1
            await asyncio.sleep(0.2)
    finally:
        _warm.update(running=False, current=None)
