#!/usr/bin/env python3
"""Сборка индекса сайта из карточек recipes/*.md.

Читает все карточки, проверяет их и записывает data/catalog.js,
который загружает сайт. Нужен только стандартный Python 3, без пакетов.

Запуск из корня сайта:  python3 scripts/build.py
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECIPES = ROOT / "recipes"
OUT = ROOT / "data" / "catalog.js"

META_PREFIXES = ("**Что лечит:**", "**Раздел:**", "**Растения:**", "**Не растения:**")
NO_CATEGORY = "Без категории"


def parse_front_matter(text, warn):
    """Возвращает (словарь полей, тело карточки)."""
    if not text.startswith("---"):
        warn("нет блока --- с полями в начале файла")
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        warn("блок полей не закрыт строкой ---")
        return {}, text
    fields = {}
    for line in text[3:end].strip().splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        try:
            fields[key.strip()] = json.loads(value)
        except json.JSONDecodeError:
            # Допускаем значение без кавычек и список без кавычек: [a, b]
            if value.startswith("[") and value.endswith("]"):
                fields[key.strip()] = [v.strip().strip("\"'") for v in value[1:-1].split(",") if v.strip()]
            else:
                fields[key.strip()] = value.strip("\"'")
    return fields, text[end + 4:].lstrip("\n")


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in re.split(r"[;,]", str(value)) if v.strip()]


def category_parts(body, prefix):
    """Части строки «**Растения:** Мята (Лекарственные травы); ...»."""
    for line in body.splitlines():
        if line.startswith(prefix):
            return [p.strip() for p in line[len(prefix):].split(";")]
    return []


def with_categories(names, body, prefix, fallback_cats):
    parts = category_parts(body, prefix)
    items = []
    for name in names:
        cat = None
        for part in parts:
            # Категория может сама содержать скобки: «Прочее (предметы и обряды)»
            if part.startswith(name + " (") and part.endswith(")"):
                cat = part[len(name) + 2:-1].strip()
                break
        if not cat and len(fallback_cats) == 1:
            cat = fallback_cats[0]
        items.append({"name": name, "cat": cat or NO_CATEGORY})
    return items


def clean_body(body):
    """Убирает заголовок, служебные строки и раздел «Источник»."""
    lines = body.splitlines()
    out = []
    seen_section = False
    skip = False
    for line in lines:
        if line.startswith("## "):
            seen_section = True
            skip = line[3:].strip().lower() == "источник"
            if skip:
                continue
        if skip:
            continue
        if not seen_section and (line.startswith("# ") or line.startswith(META_PREFIXES)):
            continue
        out.append(line)
    return "\n".join(out).strip()


def main():
    files = sorted(RECIPES.glob("*.md"))
    recipes = []
    problems = 0
    titles = {}
    for path in files:
        def warn(msg, path=path):
            nonlocal problems
            problems += 1
            print(f"  ! {path.name}: {msg}")

        text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        fields, body = parse_front_matter(text, warn)
        title = str(fields.get("название") or "").strip()
        if not title:
            m = re.search(r"^# (.+)$", body, re.M)
            title = m.group(1).strip() if m else path.stem
            warn("нет поля «название», взят заголовок")
        diseases = as_list(fields.get("что_лечит"))
        if not diseases:
            warn("пустое поле «что_лечит»")
        section = str(fields.get("раздел") or "").strip() or "Без раздела"
        plants = with_categories(as_list(fields.get("растения")), body, "**Растения:**",
                                 as_list(fields.get("категории_растений")))
        others = with_categories(as_list(fields.get("не_растения")), body, "**Не растения:**",
                                 as_list(fields.get("категории_не_растений")))
        if title in titles:
            warn(f"такое же название уже у {titles[title]}")
        titles[title] = path.name
        recipes.append({
            "id": path.stem,
            "file": path.name,
            "title": title,
            "diseases": diseases,
            "section": section,
            "plants": plants,
            "others": others,
            "body": clean_body(body),
        })

    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(recipes),
        "recipes": recipes,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("window.CATALOG = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"Готово: {len(recipes)} карточек → {OUT.relative_to(ROOT)}")
    if problems:
        print(f"Замечаний: {problems} (сайт всё равно собран)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
