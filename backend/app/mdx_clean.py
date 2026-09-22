"""Turn Mintlify MDX (React components, Mermaid, JSX exports) into plain Markdown that both the
Learn viewer and the answering model can read."""
import re

CALLOUTS = ("Note", "Tip", "Warning", "Info", "Check", "Danger")


def _strip_export_blocks(md: str) -> str:
    """Remove `export function X(...) { ... }` / `export const ...` blocks (top-level JS in MDX)."""
    lines = md.split("\n")
    out, i = [], 0
    while i < len(lines):
        if re.match(r"^export\s+(function|const|default)\b", lines[i]):
            depth = 0
            started = False
            while i < len(lines):
                depth += lines[i].count("{") - lines[i].count("}")
                started = started or "{" in lines[i]
                i += 1
                if started and depth <= 0:
                    break
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def _example_components(md: str) -> str:
    """<TypesafeExample title=".." example={{ ... }} /> -> fenced js block with the example."""
    def repl(m):
        attrs, body = m.group(1), m.group(2)
        t = re.search(r'title="([^"]*)"', attrs)
        label = t.group(1) if t else "example"
        return f"**Example ({label})**\n\n```js\n{body.strip()}\n```\n"
    return re.sub(r"<TypesafeExample([^>]*?)example=\{\{(.*?)\}\}\s*/>", repl, md, flags=re.S)


def _mermaid(md: str) -> str:
    return re.sub(r"```mermaid[^\n]*\n.*?```", "> _[flow diagram — open the source page to view it]_", md, flags=re.S)


def _fences(md: str) -> str:
    # ```json Example request focus={5-9} theme={null}  ->  ```json
    return re.sub(r"^```([A-Za-z0-9_+-]*)[^\n]*$", r"```\1", md, flags=re.M)


def _field(m: "re.Match[str]") -> str:
    typ = re.sub("&#x22;|&quot;", '"', m.group(2))
    req = ", required" if "required" in m.group(3) else ""
    return f"- `{m.group(1)}` ({typ}{req})"


def _components(md: str) -> str:
    for c in CALLOUTS:
        md = re.sub(rf"<{c}(?:\s[^>]*)?>\s*(.*?)\s*</{c}>", lambda m, c=c: "> **" + c + ":** " + re.sub(r"\n\s*\n", "\n>\n> ", m.group(1).strip()), md, flags=re.S)
    md = re.sub(r"<(Tab|Step|Accordion|Card)\s+title=\"([^\"]*)\"[^>]*>", r"\n**\2**\n", md)
    md = re.sub(r"<ParamField\s+(?:body|path|query|header)=\"([^\"]*)\"\s+type=\"([^\"]*)\"([^>]*?)/?>", _field, md)
    md = re.sub(r"<ResponseField\s+name=\"([^\"]*)\"\s+type=\"([^\"]*)\"([^>]*?)/?>", _field, md)
    md = re.sub(r"<Expandable\s+title=\"([^\"]*)\"[^>]*>", r"\n_\1:_\n", md)
    md = re.sub(r"<(ScoreExplorer|ConfidenceExplorer|NoulExplorer|ChoiceExplorer)[^>]*?/?>(?:.*?</\1>)?", "> _[interactive explorer — open the source page to try it]_", md, flags=re.S)
    md = re.sub(r"<Frame[^>]*>\s*<img[^>]*src=\"([^\"]*)\"[^>]*>\s*</Frame>", r"![image](\1)", md, flags=re.S)
    # any remaining capitalised JSX tags (Tabs, Columns, Steps, Frame, AccordionGroup, ...): drop the tag, keep the content
    md = re.sub(r"</?[A-Z][A-Za-z]*(?:\s[^<>]*?)?/?>", "", md)
    return md


def clean(md: str) -> str:
    md = re.sub(r"^<!-- source: .*? -->\n+", "", md)
    md = re.sub(r"^> ## Documentation Index\n(> .*\n)+", "", md, flags=re.M)
    md = re.sub(r"^import\s.*$", "", md, flags=re.M)
    md = _strip_export_blocks(md)
    md = _example_components(md)
    md = _mermaid(md)
    md = _fences(md)
    md = _components(md)
    md = re.sub(r"\{/\*.*?\*/\}", "", md, flags=re.S)       # {/* mdx comments */}
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()
