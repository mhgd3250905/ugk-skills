#!/usr/bin/env python3
"""Reddit latest keyword search with exact N-day filtering."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

BASE_URL = "https://www.reddit.com"
USER_AGENT = "NanoClawRedditSearchLatest/1.0"
MAX_LIMIT = 100
DEFAULT_LIMIT = 50

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


@dataclass
class SearchResult:
    created_utc: float
    subreddit: str
    author: str
    title: str
    selftext: str
    score: int
    num_comments: int
    permalink: str


def select_timeframe(days: int) -> str:
    if days <= 1:
        return "day"
    if days <= 7:
        return "week"
    if days <= 30:
        return "month"
    if days <= 365:
        return "year"
    return "all"


def build_search_url(keyword: str, days: int, limit: int) -> str:
    params = {
        "q": keyword,
        "sort": "new",
        "t": select_timeframe(days),
        "limit": min(max(limit, 1), MAX_LIMIT),
    }
    return f"{BASE_URL}/search.json?{urlencode(params)}"


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise RuntimeError("Reddit 速率限制（429），请稍后重试。") from exc
        if exc.code == 403:
            raise RuntimeError("Reddit 拒绝访问（403），当前环境可能被风控或限制。") from exc
        if exc.code == 404:
            raise RuntimeError("Reddit 搜索接口返回 404。") from exc
        raise RuntimeError(f"Reddit HTTP 错误：{exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"连接 Reddit 失败：{exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Reddit 返回内容不是有效 JSON。") from exc


def parse_results(payload: dict[str, Any]) -> list[SearchResult]:
    children = payload.get("data", {}).get("children", [])
    results: list[SearchResult] = []
    for child in children:
        data = child.get("data", {})
        permalink = data.get("permalink", "")
        results.append(
            SearchResult(
                created_utc=float(data.get("created_utc", 0)),
                subreddit=data.get("subreddit_name_prefixed", "r/unknown"),
                author=data.get("author", "[deleted]"),
                title=data.get("title", "").strip(),
                selftext=(data.get("selftext", "") or "").strip(),
                score=int(data.get("score", 0) or 0),
                num_comments=int(data.get("num_comments", 0) or 0),
                permalink=f"{BASE_URL}{permalink}" if permalink else "",
            )
        )
    return results


def filter_recent_results(results: list[SearchResult], days: int) -> list[SearchResult]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_ts = cutoff.timestamp()
    filtered = [item for item in results if item.created_utc >= cutoff_ts]
    filtered.sort(key=lambda item: item.created_utc, reverse=True)
    return filtered


def format_timestamp(created_utc: float) -> str:
    return datetime.fromtimestamp(created_utc, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def summarize_text(text: str, limit: int = 180) -> str:
    clean = " ".join(text.split())
    if not clean:
        return "（正文为空或仅标题帖）"
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3] + "..."


def render_output(keyword: str, days: int, url: str, results: list[SearchResult]) -> str:
    lines = [
        "Reddit Latest 查询结果",
        f"关键词：{keyword}",
        f"时间范围：最近 {days} 天",
        f"查询地址：{url}",
        "",
    ]

    if not results:
        lines.append("结果概览：未检索到满足条件的结果。")
        return "\n".join(lines)

    lines.append(f"结果概览：共筛选出 {len(results)} 条最近 {days} 天内的结果。")
    lines.append("")
    lines.append("结果列表：")

    for idx, item in enumerate(results, start=1):
        lines.extend(
            [
                f"{idx}. 时间：{format_timestamp(item.created_utc)}",
                f"   子版块：{item.subreddit}",
                f"   作者：{item.author}",
                f"   标题：{item.title or '（无标题）'}",
                f"   内容摘要：{summarize_text(item.selftext)}",
                f"   评分：{item.score}",
                f"   评论数：{item.num_comments}",
                f"   链接：{item.permalink or '（无链接）'}",
            ]
        )

    return "\n".join(lines)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("必须是正整数")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="按关键词查询 Reddit 最新帖子，并精确筛选最近 N 天结果。")
    parser.add_argument("--keyword", required=True, help="查询关键词，保持原文传入")
    parser.add_argument("--days", type=positive_int, default=30, help="最近多少天，默认 30")
    parser.add_argument("--limit", type=positive_int, default=DEFAULT_LIMIT, help="拉取候选结果数量，默认 50，最大 100")
    parser.add_argument("--dry-run", action="store_true", help="只输出最终查询地址和过滤配置，不发网络请求")
    args = parser.parse_args()

    keyword = args.keyword.strip()
    if not keyword:
        print("错误：关键词不能为空。", file=sys.stderr)
        return 1

    final_url = build_search_url(keyword, args.days, args.limit)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "keyword": keyword,
                    "days": args.days,
                    "timeframe": select_timeframe(args.days),
                    "limit": min(max(args.limit, 1), MAX_LIMIT),
                    "url": final_url,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    try:
        payload = fetch_json(final_url)
        filtered = filter_recent_results(parse_results(payload), args.days)
    except RuntimeError as exc:
        print(f"Reddit Latest 查询失败：{exc}", file=sys.stderr)
        return 1

    print(render_output(keyword, args.days, final_url, filtered))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
