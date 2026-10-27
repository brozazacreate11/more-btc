"""Обновява data/*.json. Пуска се автоматично от GitHub Actions (виж .github/workflows/update-data.yml).

Формат на ценовите файлове: {"updated": ISO, "d": [[ден_от_1970, цена], ...]}
"""
import datetime as dt
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
UA = {"User-Agent": "Mozilla/5.0 (more-btc data updater)"}
NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def day(unix_s):
    return int(unix_s // 86400)


def load(name):
    try:
        return {int(d): p for d, p in json.loads((DATA / name).read_text("utf-8"))["d"]}
    except Exception:
        return {}


def save(name, series):
    pts = [[d, round(series[d], 4)] for d in sorted(series)]
    (DATA / name).write_text(json.dumps({"updated": NOW, "d": pts}, separators=(",", ":")), "utf-8")
    print(f"{name}: {len(pts)} points")


def step(fn):
    try:
        fn()
    except Exception as e:  # един провален източник не трябва да спира останалите
        print(f"{fn.__name__} FAILED: {e}", file=sys.stderr)


def btc():
    s = load("btc.json")
    if len(s) < 1000:
        for v in json.loads(get("https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=false"))["values"]:
            if v["y"] > 0:
                s[day(v["x"])] = v["y"]
    # последните дни: Coinbase работи от сървърите на GitHub (САЩ); Binance там връща HTTP 451, затова е само резерва
    try:
        for c in json.loads(get("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400")):
            s[day(c[0])] = float(c[4])  # [време, low, high, open, close, обем]
    except Exception as e:
        print(f"coinbase FAILED: {e}", file=sys.stderr)
        for k in json.loads(get("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000")):
            s[day(k[0] / 1000)] = float(k[4])
    save("btc.json", s)


def mstr():
    s = load("mstr.json")
    r = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/MSTR?period1=1262304000&period2=4102444800&interval=1d"))["chart"]["result"][0]
    for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
        if c:
            s[day(t)] = c
    save("mstr.json", s)


def eurusd():
    s = load("eurusd.json")
    start = "2010-01-01" if len(s) < 1000 else (dt.date.today() - dt.timedelta(days=30)).isoformat()
    r = json.loads(get(f"https://api.frankfurter.dev/v1/{start}..{dt.date.today().isoformat()}?from=EUR&to=USD"))
    for d, v in r["rates"].items():
        s[(dt.date.fromisoformat(d) - dt.date(1970, 1, 1)).days] = v["USD"]
    save("eurusd.json", s)


def news():
    root = ET.fromstring(get("https://bitcoinmagazine.com/.rss/full/"))
    ns = {"media": "http://search.yahoo.com/mrss/"}
    items = []
    for it in root.iter("item"):
        img = it.find("media:content", ns)
        if img is None:
            img = it.find("enclosure")
        title = html.unescape(it.findtext("title") or "").strip()
        desc = re.sub(r"<[^>]+>", " ", html.unescape(it.findtext("description") or ""))
        desc = re.sub(r"\s+", " ", html.unescape(desc)).strip()
        desc = re.sub(r"^\W*Bitcoin Magazine\s*", "", desc)  # описанието започва с „Bitcoin Magazine <заглавие>“
        if desc.startswith(title):
            desc = desc[len(title):].strip()
        pub = dt.datetime.strptime(it.findtext("pubDate").strip(), "%a, %d %b %Y %H:%M:%S %z")
        items.append({
            "title": title,
            "link": (it.findtext("link") or "").strip(),
            "date": pub.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "img": img.get("url") if img is not None else None,
            "desc": desc[:220] + ("…" if len(desc) > 220 else ""),
        })
    (DATA / "news.json").write_text(json.dumps({"updated": NOW, "source": "Bitcoin Magazine", "items": items[:30]}, ensure_ascii=False), "utf-8")
    print(f"news.json: {len(items)} items")


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    for f in (btc, mstr, eurusd, news):
        step(f)
