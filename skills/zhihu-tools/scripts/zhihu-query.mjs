/**
 * 知乎查询统一入口
 * 根据命令类型调用对应的 API
 */

import {
  getHotList,
  getAnswers,
  getComments,
  search,
  getUser,
  extractQuestionId,
  extractAnswerId,
  extractUserToken
} from './zhihu-api.mjs';

/**
 * 解析命令并执行查询
 * @param {string} command 用户命令
 */
export async function query(command) {
  // 解析命令类型
  const normalized = command.toLowerCase().trim();
  
  // 热榜
  if (normalized.includes('热榜') || normalized.includes('热门') || normalized === '知乎hot' || normalized === '知乎') {
    return await queryHotList();
  }
  
  // 搜索
  if (normalized.includes('搜索') || normalized.includes('搜')) {
    const queryMatch = normalized.match(/(?:搜索|搜)\s*(.+)/);
    if (queryMatch) {
      return await querySearch(queryMatch[1].trim());
    }
  }
  
  // 问题回答
  if (normalized.includes('问题') || normalized.includes('回答')) {
    const idMatch = normalized.match(/(?:问题|回答)\s*(\d+)/);
    const urlMatch = normalized.match(/(?:问题|回答)\s*(https?:\/\/[^\s]+)/);
    
    let questionId;
    if (urlMatch) {
      questionId = extractQuestionId(urlMatch[1]);
    } else if (idMatch) {
      questionId = idMatch[1];
    }
    
    if (questionId) {
      // 判断排序
      let sortBy = 'default';
      if (normalized.includes('按赞') || normalized.includes('最高赞')) sortBy = 'voteups';
      if (normalized.includes('最新') || normalized.includes('按时间')) sortBy = 'created';
      
      return await queryAnswers(questionId, { sortBy });
    }
  }
  
  // 评论
  if (normalized.includes('评论')) {
    const answerIdMatch = normalized.match(/评论\s*(\d+)/);
    const urlMatch = normalized.match(/评论\s*(https?:\/\/[^\s]+)/);
    
    let answerId;
    if (urlMatch) {
      answerId = extractAnswerId(urlMatch[1]);
    } else if (answerIdMatch) {
      answerId = answerIdMatch[1];
    }
    
    if (answerId) {
      return await queryComments(answerId);
    }
  }
  
  // 用户
  if (normalized.includes('用户')) {
    const tokenMatch = normalized.match(/用户\s*(\S+)/);
    const urlMatch = normalized.match(/用户\s*(https?:\/\/[^\s]+)/);
    
    let userToken;
    if (urlMatch) {
      userToken = extractUserToken(urlMatch[1]);
    } else if (tokenMatch) {
      userToken = tokenMatch[1];
    }
    
    if (userToken) {
      return await queryUser(userToken);
    }
  }
  
  // 默认返回热榜
  return await queryHotList();
}

async function queryHotList() {
  const items = await getHotList(15);
  
  let output = '## 知乎热榜\n\n';
  output += '| 排名 | 热点话题 | 热度 |\n';
  output += '|------|----------|------|\n';
  
  items.forEach((item, i) => {
    output += `| ${i + 1} | **${item.title.slice(0, 50)}** | ${item.hotValue} |\n`;
  });
  
  return output;
}

async function queryAnswers(questionId, options = {}) {
  const result = await getAnswers(questionId, { ...options, limit: 10 });
  
  let output = `## 知乎问题 ${questionId} 的回答\n\n`;
  output += `排序: ${options.sortBy || '默认'}\n\n`;
  
  result.items.forEach((item, i) => {
    output += `### ${i + 1}. ${item.author.name}`;
    if (item.author.headline) output += ` (${item.author.headline})`;
    output += `\n`;
    output += `👍 ${item.voteup_count} 赞同 | 💬 ${item.comment_count} 评论\n\n`;
    output += `${item.excerpt}\n\n`;
    output += `[查看完整回答](${item.url})\n\n`;
    output += `---\n\n`;
  });
  
  if (result.hasMore) {
    output += `*还有更多回答...*\n`;
  }
  
  return output;
}

async function queryComments(answerId) {
  const result = await getComments(answerId, 10);
  
  let output = `## 回答 ${answerId} 的评论\n\n`;
  output += `共 ${result.total} 条评论\n\n`;
  
  result.items.forEach((item, i) => {
    output += `**${item.author.name}**: ${item.content}\n`;
    output += `👍 ${item.vote_count} | 时间: ${formatTime(item.created_time)}\n\n`;
  });
  
  return output;
}

async function querySearch(keyword) {
  const items = await search(keyword, 'general', 10);
  
  let output = `## 知乎搜索: "${keyword}"\n\n`;
  
  items.forEach((item, i) => {
    output += `${i + 1}. [${item.type}] **${item.title.slice(0, 60)}**\n`;
    if (item.author) output += `   作者: ${item.author}\n`;
    if (item.excerpt) output += `   ${item.excerpt.slice(0, 80)}...\n`;
    if (item.url) output += `   [链接](${item.url})\n`;
    output += `\n`;
  });
  
  return output;
}

async function queryUser(userToken) {
  const user = await getUser(userToken);
  
  let output = `## 知乎用户: ${user.name}\n\n`;
  if (user.headline) output += `${user.headline}\n\n`;
  output += `| 统计 | 数值 |\n`;
  output += `|------|------|\n`;
  output += `| 回答数 | ${user.answer_count} |\n`;
  output += `| 文章数 | ${user.article_count} |\n`;
  output += `| 关注者 | ${user.follower_count} |\n`;
  output += `| 关注数 | ${user.following_count} |\n`;
  output += `\n[用户主页](${user.url})\n`;
  
  return output;
}

function formatTime(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('zh-CN');
}

// 直接运行时的入口
if (process.argv[2]) {
  query(process.argv[2]).then(console.log).catch(e => console.error('错误:', e.message));
}