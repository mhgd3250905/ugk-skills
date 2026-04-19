/**
 * 小红书查询统一入口
 * 根据命令类型调用对应的 API
 */

import {
  searchNotes,
  getNoteDetail,
  getNoteComments,
  getUserInfo,
  getUserNotes,
  getHomeFeed,
  extractNoteId,
  extractUserId
} from './xhs-api.mjs';

/**
 * 解析命令并执行查询
 * @param {string} command 用户命令
 */
export async function query(command) {
  const normalized = command.toLowerCase().trim();

  // 搜索
  if (normalized.includes('搜索') || normalized.includes('搜')) {
    const queryMatch = normalized.match(/(?:小红书|红书)?(?:搜索|搜)\s*(.+)/);
    if (queryMatch) {
      return await querySearch(queryMatch[1].trim());
    }
  }

  // 评论
  if (normalized.includes('评论')) {
    const idMatch = normalized.match(/评论\s*([a-zA-Z0-9]+)/);
    const urlMatch = normalized.match(/评论\s*(https?:\/\/[^\s]+)/);
    const noteIdMatch = normalized.match(/笔记\s*([a-zA-Z0-9]+).*评论/);

    let noteId;
    if (urlMatch) {
      noteId = extractNoteId(urlMatch[1]);
    } else if (idMatch) {
      noteId = idMatch[1];
    } else if (noteIdMatch) {
      noteId = noteIdMatch[1];
    }

    if (noteId) {
      return await queryComments(noteId);
    }
  }

  // 笔记详情
  if (normalized.includes('笔记') && !normalized.includes('用户') && !normalized.includes('评论')) {
    const idMatch = normalized.match(/笔记\s*([a-zA-Z0-9]+)/);
    const urlMatch = normalized.match(/笔记\s*(https?:\/\/[^\s]+)/);

    let noteId;
    if (urlMatch) {
      noteId = extractNoteId(urlMatch[1]);
    } else if (idMatch) {
      noteId = idMatch[1];
    }

    if (noteId) {
      return await queryNoteDetail(noteId);
    }
  }

  // 用户笔记
  if (normalized.includes('用户') && normalized.includes('笔记')) {
    const idMatch = normalized.match(/用户\s*([a-zA-Z0-9]+)/);
    const urlMatch = normalized.match(/用户\s*(https?:\/\/[^\s]+)/);

    let userId;
    if (urlMatch) {
      userId = extractUserId(urlMatch[1]);
    } else if (idMatch) {
      userId = idMatch[1];
    }

    if (userId) {
      return await queryUserNotes(userId);
    }
  }

  // 用户信息
  if (normalized.includes('用户')) {
    const idMatch = normalized.match(/用户\s*([a-zA-Z0-9]+)/);
    const urlMatch = normalized.match(/用户\s*(https?:\/\/[^\s]+)/);

    let userId;
    if (urlMatch) {
      userId = extractUserId(urlMatch[1]);
    } else if (idMatch) {
      userId = idMatch[1];
    }

    if (userId) {
      return await queryUser(userId);
    }
  }

  // 热门推荐
  if (normalized.includes('热门') || normalized.includes('推荐') || normalized === '小红书' || normalized === '红书') {
    return await queryHomeFeed();
  }

  // 默认搜索
  const keywordMatch = normalized.match(/(?:小红书|红书)\s*(.+)/);
  if (keywordMatch) {
    return await querySearch(keywordMatch[1].trim());
  }

  // 默认返回热门
  return await queryHomeFeed();
}

async function querySearch(keyword) {
  const result = await searchNotes(keyword, 1, 15);

  let output = `## 小红书搜索: "${keyword}"\n\n`;

  if (result.items.length === 0) {
    output += '*未找到相关笔记*\n';
    return output;
  }

  result.items.forEach((item, i) => {
    output += `### ${i + 1}. ${item.title || '(无标题)'}\n`;
    output += `👤 ${item.author.nickname}\n`;
    output += `❤️ ${formatNumber(item.interactInfo.likeCount)} | ⭐ ${formatNumber(item.interactInfo.collectCount)} | 💬 ${formatNumber(item.interactInfo.commentCount)}\n`;
    if (item.desc) {
      output += `${item.desc.slice(0, 80)}${item.desc.length > 80 ? '...' : ''}\n`;
    }
    output += `[查看笔记](${item.link})\n\n`;
  });

  if (result.hasMore) {
    output += '*还有更多结果...*\n';
  }

  return output;
}

async function queryNoteDetail(noteId) {
  const note = await getNoteDetail(noteId);

  let output = `## ${note.title || '笔记详情'}\n\n`;

  output += `**作者**: ${note.author.nickname}\n`;
  output += `**类型**: ${note.type === 'video' ? '视频' : '图文'}\n`;
  output += `**互动**: ❤️ ${formatNumber(note.interactInfo.likeCount)} | ⭐ ${formatNumber(note.interactInfo.collectCount)} | 💬 ${formatNumber(note.interactInfo.commentCount)} | 🔗 ${formatNumber(note.interactInfo.shareCount)}\n`;

  if (note.tags && note.tags.length > 0) {
    output += `**标签**: ${note.tags.map(t => '#' + t).join(' ')}\n`;
  }

  output += `\n---\n\n`;
  output += `${note.desc || '(无正文)'}\n\n`;

  if (note.images && note.images.length > 0) {
    output += `**图片** (${note.images.length}张):\n`;
    note.images.forEach((img, i) => {
      output += `${i + 1}. ${img}\n`;
    });
  }

  if (note.video) {
    output += `**视频**: ${note.video}\n`;
  }

  output += `\n[查看原文](${note.link})\n`;

  return output;
}

async function queryComments(noteId) {
  const result = await getNoteComments(noteId, 15);

  let output = `## 笔记 ${noteId} 的评论\n\n`;

  if (result.items.length === 0) {
    output += '*暂无评论*\n';
    return output;
  }

  result.items.forEach((item, i) => {
    output += `### ${i + 1}. ${item.author.nickname}\n`;
    output += `${item.content}\n`;
    output += `❤️ ${item.likeCount} | ${formatTime(item.time)}\n\n`;
  });

  if (result.hasMore) {
    output += '*还有更多评论...*\n';
  }

  return output;
}

async function queryUser(userId) {
  const user = await getUserInfo(userId);

  let output = `## 小红书用户: ${user.nickname}\n\n`;

  if (user.desc) {
    output += `${user.desc}\n\n`;
  }

  output += `| 统计 | 数值 |\n`;
  output += `|------|------|\n`;
  output += `| 笔记数 | ${formatNumber(user.notes)} |\n`;
  output += `| 粉丝数 | ${formatNumber(user.fans)} |\n`;
  output += `| 关注数 | ${formatNumber(user.follows)} |\n`;
  output += `| 获赞数 | ${formatNumber(user.liked)} |\n`;

  if (user.location) {
    output += `\n**位置**: ${user.location}\n`;
  }

  output += `\n[用户主页](${user.link})\n`;

  return output;
}

async function queryUserNotes(userId) {
  const result = await getUserNotes(userId, 10);

  let output = `## 用户 ${userId} 的笔记\n\n`;

  if (result.items.length === 0) {
    output += '*暂无笔记*\n';
    return output;
  }

  result.items.forEach((item, i) => {
    output += `### ${i + 1}. ${item.title || '(无标题)'}\n`;
    output += `类型: ${item.type === 'video' ? '视频' : '图文'} | ❤️ ${formatNumber(item.interactInfo.likeCount)} | ⭐ ${formatNumber(item.interactInfo.collectCount)}\n`;
    if (item.desc) {
      output += `${item.desc.slice(0, 60)}...\n`;
    }
    output += `[查看笔记](${item.link})\n\n`;
  });

  if (result.hasMore) {
    output += '*还有更多笔记...*\n';
  }

  return output;
}

async function queryHomeFeed() {
  const items = await getHomeFeed(15);

  let output = `## 小红书热门推荐\n\n`;

  if (items.length === 0) {
    output += '*暂无推荐内容，请确保已登录小红书*\n';
    return output;
  }

  items.forEach((item, i) => {
    output += `### ${i + 1}. ${item.title || '(无标题)'}\n`;
    output += `👤 ${item.author.nickname}\n`;
    output += `❤️ ${formatNumber(item.interactInfo.likeCount)} | ⭐ ${formatNumber(item.interactInfo.collectCount)} | 💬 ${formatNumber(item.interactInfo.commentCount)}\n`;
    if (item.desc) {
      output += `${item.desc.slice(0, 60)}...\n`;
    }
    output += `[查看笔记](${item.link})\n\n`;
  });

  return output;
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + 'w';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return String(num);
}

function formatTime(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(typeof timestamp === 'number' ? timestamp * 1000 : timestamp);
  return date.toLocaleDateString('zh-CN');
}

// 直接运行时的入口
if (process.argv[2]) {
  query(process.argv[2]).then(console.log).catch(e => console.error('错误:', e.message));
}