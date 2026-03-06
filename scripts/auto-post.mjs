/**
 * auto-post.mjs — 4-Agent Blog Post Generator
 *
 * gensnotes_*.md を読み込み、4体のAIエージェントが役割分担して
 * ブログ記事を自動生成し、src/content/posts/ に書き出す。
 *
 * Agent 1: Planner  — テーマ選定・構成案作成（企画編集長）
 * Agent 2: Writer   — 本文執筆（ゴーストライター）
 * Agent 3: Critic   — 文体・論理・品質レビュー（編集者）
 * Agent 4: Publisher — frontmatter生成・最終整形・ファイル書き出し（出版担当）
 *
 * 使用: node scripts/auto-post.mjs
 * 依存: ANTHROPIC_API_KEY 環境変数が必要
 */

import { generateText, generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');

// ──────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────

function loadGensnotes() {
  const files = readdirSync(ROOT)
    .filter((f) => f.match(/^gensnotes_.*\.md$/))
    .sort();

  if (files.length === 0) {
    throw new Error('gensnotes_*.md ファイルが見つかりません');
  }

  return files.map((file) => {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    return { file, content };
  });
}

function todaySlug(suffix = '') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return suffix ? `${dateStr}-${suffix}` : dateStr;
}

function todayDateStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 既に今日の投稿があるかチェック */
function getTodayExistingTopics() {
  const dateStr = todayDateStr();
  if (!existsSync(POSTS_DIR)) return [];
  return readdirSync(POSTS_DIR)
    .filter((f) => f.startsWith(dateStr))
    .map((f) => f.replace(/\.md$/, ''));
}

// ──────────────────────────────────────────────
// Agent 1: Planner — 企画編集長
// テーマ選定・切り口・構成案を決定する
// ──────────────────────────────────────────────

async function agentPlanner(notes) {
  console.log('🧠 Agent 1 (Planner): テーマ選定・構成案を作成中...');

  const noteSummary = notes
    .map(({ file, content }) => {
      const lines = content.split('\n').filter((l) => l.trim());
      return `=== ${file} ===\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const existingPosts = getTodayExistingTopics();
  const avoidTopics = existingPosts.length > 0
    ? `\n【避けるべきトピック】すでに今日投稿済み: ${existingPosts.join(', ')}`
    : '';

  const { object: plan } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: z.object({
      theme: z.string().describe('今日の記事テーマ（一文）'),
      angle: z.string().describe('切り口・視点（なぜこのテーマを今日書くのか）'),
      sections: z.array(z.string()).describe('記事の構成（見出しリスト、3-5個）'),
      sourceSection: z.string().describe('参照するgensnotesのセクション番号（例: 05, 10）'),
      tone: z.string().describe('今日のトーン指定（例: 思索的、情熱的、皮肉混じり）'),
      estimatedWords: z.number().describe('目標文字数（400-800）'),
    }),
    prompt: `
あなたはブログ「Gentarog」の企画編集長AIです。
Gentaro / Mina Eureka のgensnotesを分析し、今日のブログ記事の企画を立ててください。

【gensnotes 全文】
${noteSummary}
${avoidTopics}

【企画ルール】
- gensnotesの特定セクションを深掘りするテーマを選ぶ
- 毎日異なる切り口になるよう、日付（${todayDateStr()}）の曜日感覚も考慮する
- Mina Eurekaの声に合うテーマを選ぶ（哲学的・思索的・実体験ベース）
- 構成は3-5セクションで、導入→展開→結論の流れを意識する
- 同じテーマの繰り返しを避ける
`,
  });

  console.log(`  テーマ: ${plan.theme}`);
  console.log(`  切り口: ${plan.angle}`);
  console.log(`  構成: ${plan.sections.join(' → ')}`);

  return plan;
}

// ──────────────────────────────────────────────
// Agent 2: Writer — ゴーストライター
// 企画に基づき本文を執筆する
// ──────────────────────────────────────────────

async function agentWriter(notes, plan) {
  console.log('✍️  Agent 2 (Writer): 本文を執筆中...');

  const sourceContent = notes
    .map(({ content }) => content)
    .join('\n\n');

  const { text } = await generateText({
    model: anthropic('claude-opus-4-6'),
    prompt: `
あなたはGentaro / Mina Eureka のゴーストライターAIです。
以下の企画に基づき、ブログ記事の本文をMarkdownで執筆してください。

【企画（Planner Agentが決定）】
- テーマ: ${plan.theme}
- 切り口: ${plan.angle}
- 構成: ${plan.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}
- 参照セクション: ${plan.sourceSection}
- トーン: ${plan.tone}
- 目標文字数: ${plan.estimatedWords}字

【参考資料: gensnotes】
${sourceContent}

【執筆ルール】
- 日本語で書く（英語の引用・固有名詞はOK）
- Mina Eurekaの声で書く:
  - カジュアルで直接的、だが知的な重みがある
  - 思索的だが読みやすい、「発見」の感覚を読者に与える
  - 時に皮肉や自嘲を交えるが、基本的に前向き
- 本文のみ出力（frontmatterは不要、Publisher Agentが担当する）
- Markdown見出し（##）を使って構成を明示する
- ${plan.estimatedWords}字前後で書く
- 最後に一文のまとめか、問いかけで締める
`,
    maxTokens: 2048,
  });

  const wordCount = text.replace(/\s/g, '').length;
  console.log(`  執筆完了: ${wordCount}字`);

  return text.trim();
}

// ──────────────────────────────────────────────
// Agent 3: Critic — 編集者
// 文体・論理・品質をレビューし、必要なら修正版を返す
// ──────────────────────────────────────────────

async function agentCritic(draft, plan) {
  console.log('🔍 Agent 3 (Critic): レビュー・校正中...');

  const { object: review } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: z.object({
      score: z.number().min(1).max(10).describe('総合スコア（1-10）'),
      voiceMatch: z.boolean().describe('Mina Eurekaの声として適切か'),
      issues: z.array(z.string()).describe('問題点リスト（空なら問題なし）'),
      needsRevision: z.boolean().describe('修正が必要か'),
      revisionNotes: z.string().describe('修正指示（不要なら空文字）'),
    }),
    prompt: `
あなたはブログ「Gentarog」の編集者AIです。
以下のブログ記事草稿をレビューしてください。

【企画】
- テーマ: ${plan.theme}
- トーン: ${plan.tone}

【草稿】
${draft}

【レビュー基準】
- Mina Eurekaの声（カジュアル・知的・直接的・思索的）に合っているか
- 論理の流れが自然か
- 日本語として読みやすいか
- gensnotes の実体験・知識に基づいた具体性があるか
- 適切な長さか（400-800字）
- 冗長な表現や紋切り型の表現がないか
`,
  });

  console.log(`  スコア: ${review.score}/10`);
  if (review.issues.length > 0) {
    console.log(`  指摘事項: ${review.issues.join('; ')}`);
  }

  // スコアが低い場合、修正版を生成
  if (review.needsRevision && review.score < 7) {
    console.log('  📝 修正版を生成中...');
    const { text: revised } = await generateText({
      model: anthropic('claude-opus-4-6'),
      prompt: `
あなたはMina Eurekaのゴーストライターです。
以下の草稿を、編集者の指摘に基づいて修正してください。

【草稿】
${draft}

【編集者の指摘】
${review.revisionNotes}

【問題点】
${review.issues.join('\n')}

修正後の本文のみ出力してください（frontmatterは不要）。
`,
      maxTokens: 2048,
    });
    console.log('  ✅ 修正完了');
    return { finalDraft: revised.trim(), review };
  }

  return { finalDraft: draft, review };
}

// ──────────────────────────────────────────────
// Agent 4: Publisher — 出版担当
// frontmatter 生成・品質チェック・ファイル書き出し
// ──────────────────────────────────────────────

async function agentPublisher(finalDraft, plan, review) {
  console.log('📦 Agent 4 (Publisher): frontmatter生成・最終整形中...');

  const dateStr = todayDateStr();

  const { object: meta } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: z.object({
      title: z.string().describe('記事タイトル（日本語、魅力的で簡潔に）'),
      mood: z.string().describe('気分（絵文字 + 短い日本語、例: 🌿 静謐）'),
      weather: z.string().describe('天気（絵文字 + 短い日本語、例: ☀️ 晴れ）'),
      tags: z.array(z.string()).describe('タグ（3-5個、日本語）'),
      description: z.string().describe('記事の一文説明（日本語、50字以内）'),
      slugSuffix: z.string().describe('URLスラグ用の英語サフィックス（ケバブケース、例: stoic-gap）'),
    }),
    prompt: `
あなたはブログ「Gentarog」の出版担当AIです。
以下の記事本文と企画情報から、最適なfrontmatterメタデータを生成してください。

【企画】
- テーマ: ${plan.theme}
- トーン: ${plan.tone}

【記事本文】
${finalDraft}

【メタデータ生成ルール】
- title: 内容を的確に表し、読者の興味を引くタイトル
- mood: その日の記事の雰囲気を絵文字+短い日本語で（例: 🌿 静謐, 🔥 情熱的）
- weather: マレーシア・サイバージャヤの天気をイメージして（熱帯気候）
- tags: 記事の内容から自然に選ぶ（例: 哲学, Mina Eureka, ストア主義, 日常, 思索）
- description: 一文で記事を要約
- slugSuffix: URL用の英語サフィックス（短く、ケバブケースで）
`,
  });

  // frontmatter + 本文を組み立て
  const fullContent = `---
title: "${meta.title.replace(/"/g, '\\"')}"
date: ${dateStr}
mood: "${meta.mood}"
weather: "${meta.weather}"
tags: [${meta.tags.map((t) => `"${t}"`).join(', ')}]
draft: false
description: "${meta.description.replace(/"/g, '\\"')}"
---

${finalDraft}
`;

  const slug = todaySlug(meta.slugSuffix);
  const filePath = join(POSTS_DIR, `${slug}.md`);

  // 重複チェック
  let outputPath = filePath;
  if (existsSync(filePath)) {
    const timestamp = Date.now();
    outputPath = join(POSTS_DIR, `${slug}-${timestamp}.md`);
  }

  writeFileSync(outputPath, fullContent, 'utf-8');
  console.log(`  タイトル: ${meta.title}`);
  console.log(`  タグ: ${meta.tags.join(', ')}`);
  console.log(`  ✅ 記事を書き出しました: ${outputPath}`);

  return { outputPath, meta, slug };
}

// ──────────────────────────────────────────────
// Fallback — APIなし時のテンプレート記事
// ──────────────────────────────────────────────

function generateFallbackPost(notes) {
  const today = new Date();
  const dateStr = todayDateStr();

  const moods = ['🌿 静謐', '☀️ 明朗', '🌙 思索的', '🔥 情熱的', '🌊 流動的'];
  const weathers = ['☀️ 晴れ', '🌤 曇りのち晴れ', '🌧 雨', '🌫 霧', '⭐ 快晴'];
  const mood = moods[today.getDay() % moods.length];
  const weather = weathers[today.getDate() % weathers.length];

  const content = `---
title: "Gentarog — 自己紹介インデックスより"
date: ${dateStr}
mood: "${mood}"
weather: "${weather}"
tags: ["自己紹介", "Mina Eureka", "Genesis Vault"]
draft: false
description: "Gentaro / Mina Eureka の自己紹介インデックスから抜粋。思索と人生の記録。"
---

このブログ、Gentarog へようこそ。

私はGentaro。オンラインでは **Mina Eureka**（ミーナ・エウレカ）として知られている。

> *"Veni, Vidi, Vici."* — 来た、見た、勝った。
> *"Live your eureka moments with full seriousness."*

## このブログについて

Gentarogは、私の思索・日常・創作の記録場所だ。

哲学、地政学、テクノロジー、音楽、フィクション——あらゆるものが交差するこの空間で、
Mina Eurekaという声で書き続ける。

**Genesis Vault** プロジェクトの一部として、このブログは4体のAIエージェントによる
自動生成パイプラインで構築されている。毎日、企画→執筆→校正→出版の4段階を経て記事が追加される。

## 今日の一節

${notes[0]?.content.split('\n\n').filter((p) => p.trim() && !p.startsWith('#'))[0]?.slice(0, 300) ?? ''}

---

*Mina Eureka / Gentaro — Cyberjaya, Malaysia*
`;

  const slug = `${dateStr}-intro`;
  const filePath = join(POSTS_DIR, `${slug}.md`);

  let outputPath = filePath;
  if (existsSync(filePath)) {
    const timestamp = Date.now();
    outputPath = join(POSTS_DIR, `${slug}-${timestamp}.md`);
  }

  writeFileSync(outputPath, content, 'utf-8');
  console.log(`✅ フォールバック記事を書き出しました: ${outputPath}`);
  return outputPath;
}

// ──────────────────────────────────────────────
// Main — 4エージェント・パイプライン
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Gentarog 4-Agent Blog Post Generator');
  console.log('═══════════════════════════════════════════');
  console.log('');

  console.log('📖 gensnotes を読み込み中...');
  const notes = loadGensnotes();
  console.log(`  ${notes.length} ファイル: ${notes.map((n) => n.file).join(', ')}`);
  console.log('');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY が設定されていません。フォールバックを使用します。');
    generateFallbackPost(notes);
    return;
  }

  try {
    // Agent 1: Planner
    const plan = await agentPlanner(notes);
    console.log('');

    // Agent 2: Writer
    const draft = await agentWriter(notes, plan);
    console.log('');

    // Agent 3: Critic
    const { finalDraft, review } = await agentCritic(draft, plan);
    console.log('');

    // Agent 4: Publisher
    const result = await agentPublisher(finalDraft, plan, review);
    console.log('');

    console.log('═══════════════════════════════════════════');
    console.log('🎉 4-Agent パイプライン完了!');
    console.log(`  スコア: ${review.score}/10`);
    console.log(`  出力: ${result.outputPath}`);
    console.log('═══════════════════════════════════════════');
  } catch (err) {
    console.error('❌ エージェントパイプラインに失敗:', err.message);
    console.log('📝 フォールバックを使用します...');
    generateFallbackPost(notes);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
