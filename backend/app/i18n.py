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

TRANSLATE_PROMPT = """Translate the JSON values below into {lang} (native script). Keep the keys unchanged, keep the
same number of starters, and keep technical terms exactly as they are: System One, Jev, Laya, LLM,
choice, score, noul, confidence, confidence-gated routing, speculative fan-out, state, hub.
Respond with ONLY the translated JSON object."""


def _cache() -> dict[str, Any]:
    try:
        return json.loads(FILE.read_text()) if FILE.exists() else {}
    except Exception:
        return {}


async def strings(lang: str | None) -> dict[str, Any]:
    if not lang or lang == "Auto" or lang in BUILTIN:
        return {"lang": lang or "Auto", "cached": True, **BUILTIN.get(lang or "", BASE)}
    c = _cache()
    if lang in c:
        return {"lang": lang, "cached": True, **c[lang]}
    if not openrouter.get_openrouter_key():
        return {"lang": lang, "cached": False, "fallback": True, **BASE}
    try:
        out = await openrouter.chat_messages(
            [{"role": "system", "content": TRANSLATE_PROMPT.format(lang=lang)}, {"role": "user", "content": json.dumps(BASE, ensure_ascii=False)}],
            purpose="i18n", json_mode=True, temperature=0,
        )
        data = {"intro": str(out.get("intro") or BASE["intro"]), "placeholder": str(out.get("placeholder") or BASE["placeholder"]),
                "starters": [str(x) for x in (out.get("starters") or BASE["starters"])][: len(BASE["starters"])]}
    except Exception:
        return {"lang": lang, "cached": False, "fallback": True, **BASE}
    with _lock:
        c = _cache()
        c[lang] = data
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps(c, ensure_ascii=False, indent=1))
    return {"lang": lang, "cached": False, **data}
