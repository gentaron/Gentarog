/**
 * auto-post.mjs
 *
 * gensnotes_*.md を読み込み、Vercel AI SDK + Claude (claude-opus-4-6) を使って
 * ブログ記事を自動生成し、src/content/posts/ に書き出す。
 * APIが失敗した場合はテンプレートベースのフォールバックを使用する。
 *
 * 使用: node scripts/auto-post.mjs
 * 依存: ANTHROPIC_API_KEY 環境変数が必要
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');

// ──────────────────────────────────────────────
// 1. gensnotes_*.md を全て読み込む
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

// ──────────────────────────────────────────────
// 2. タイトルと文体サンプルを抽出する
// ──────────────────────────────────────────────
function extractStyleSamples(notes) {
  const samples = notes
    .map(({ file, content }) => {
      // 最初の見出しをタイトルとして抽出
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1] : file;
      // 最初の段落 (200字以内) をサンプルとして抽出
      const paraMatch = content.match(/\n\n([^\n#].{20,})/);
      const sample = paraMatch ? paraMatch[1].slice(0, 200) : '';
      return { title, sample };
    })
    .filter(Boolean);

  return samples;
}

// ──────────────────────────────────────────────
// 3. 今日の日付ベースでスラグを生成
// ──────────────────────────────────────────────
function todaySlug(suffix = '') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return suffix ? `${dateStr}-${suffix}` : dateStr;
}

// ──────────────────────────────────────────────
// 4. フォールバックテンプレート記事を生成
// ──────────────────────────────────────────────
function generateFallbackPost(notes, styles) {
  const today = new Date();
  const dateStr = todaySlug();
  const titles = styles.map((s) => s.title).join('・');

  const moods = ['🌿 静謐', '☀️ 明朗', '🌙 思索的', '🔥 情熱的', '🌊 流動的'];
  const weathers = ['☀️ 晴れ', '🌤 曇りのち晴れ', '🌧 雨', '🌫 霧', '⭐ 快晴'];
  const mood = moods[today.getDay() % moods.length];
  const weather = weathers[today.getDate() % weathers.length];

  const content = `---
title: "${titles} — 自己紹介インデックスより"
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

**Genesis Vault** プロジェクトの一部として、このブログは完全に自動化された静的サイトとして構築されている。
毎日、AIが生成した記事が追加される仕組みだ。

## 今日の一節

${notes[0]?.content.split('\n\n').filter((p) => p.trim() && !p.startsWith('#'))[0]?.slice(0, 300) ?? ''}

---

*Mina Eureka / Gentaro — Cyberjaya, Malaysia*
`;

  return { slug: `${dateStr}-intro`, content };
}

// ──────────────────────────────────────────────
// 5. Vercel AI SDK (claude-opus-4-6) で記事を生成
// ──────────────────────────────────────────────
async function generatePostWithAI(notes, styles) {
  const dateStr = todaySlug();

  // gensnotes の内容を要約して渡す（トークン節約）
  const noteSummary = notes
    .map(({ file, content }) => {
      const lines = content.split('\n').filter((l) => l.trim());
      return `=== ${file} ===\n${lines.slice(0, 60).join('\n')}`;
    })
    .join('\n\n');

  const styleSample = styles
    .map((s) => `タイトル: ${s.title}\nサンプル: ${s.sample}`)
    .join('\n---\n');

  const prompt = `
あなたはGentaro / Mina Eureka というブロガーのゴーストライターです。
以下のgensnotes（自己紹介インデックス）を参考に、ブログ記事をMarkdownで生成してください。

【参考資料: gensnotes】
${noteSummary}

【文体サンプル】
${styleSample}

【生成ルール】
- 日本語で書く（英語の引用・固有名詞はOK）
- Mina Eurekaの声で書く: カジュアルで直接的、思索的だが読みやすい
- 本文は400〜800字程度
- frontmatterを含む完全なMarkdownファイルとして出力する
- frontmatterのフォーマット:
  ---
  title: "記事タイトル"
  date: ${dateStr}
  mood: "絵文字 + 気分"
  weather: "絵文字 + 天気"
  tags: ["タグ1", "タグ2"]
  draft: false
  description: "一文の説明"
  ---
- タグはgensnotes の内容から自然に選ぶ（例: 自己紹介, 哲学, Mina Eureka, 日常, 思索）
- 記事内容はgensnotes のいずれかのセクションをもとに深掘りする

frontmatterを含む完全なMarkdownだけを出力してください。説明文は不要です。
`;

  console.log('🤖 Vercel AI SDK (claude-opus-4-6) で記事を生成中...');

  // Vercel AI SDK の generateText を使用（ストリーミングで長文対応）
  const { text } = await generateText({
    model: anthropic('claude-opus-4-6'),
    prompt,
    maxTokens: 2048,
  });

  return text.trim();
}

// ──────────────────────────────────────────────
// 6. frontmatter からスラグを抽出
// ──────────────────────────────────────────────
function extractSlugFromContent(content, fallbackDate) {
  const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  if (!titleMatch) return fallbackDate;

  const title = titleMatch[1]
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');

  return `${fallbackDate}-${title || 'post'}`;
}

// ──────────────────────────────────────────────
// 7. ファイルに書き出す（重複チェック付き）
// ──────────────────────────────────────────────
function writePost(slug, content) {
  const filePath = join(POSTS_DIR, `${slug}.md`);

  if (existsSync(filePath)) {
    const timestamp = Date.now();
    const altPath = join(POSTS_DIR, `${slug}-${timestamp}.md`);
    writeFileSync(altPath, content, 'utf-8');
    console.log(`✅ 記事を書き出しました: ${altPath}`);
    return altPath;
  }

  writeFileSync(filePath, content, 'utf-8');
  console.log(`✅ 記事を書き出しました: ${filePath}`);
  return filePath;
}

// ──────────────────────────────────────────────
// メイン
// ──────────────────────────────────────────────
async function main() {
  console.log('📖 gensnotes を読み込み中...');
  const notes = loadGensnotes();
  console.log(`  ${notes.length} ファイル読み込み完了: ${notes.map((n) => n.file).join(', ')}`);

  const styles = extractStyleSamples(notes);
  const dateStr = todaySlug();

  let postContent;
  let slug;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY が設定されていません。テンプレートフォールバックを使用します。');
    const fallback = generateFallbackPost(notes, styles);
    postContent = fallback.content;
    slug = fallback.slug;
  } else {
    try {
      postContent = await generatePostWithAI(notes, styles);
      slug = extractSlugFromContent(postContent, dateStr);
    } catch (err) {
      console.error('❌ AI生成に失敗:', err.message);
      console.log('📝 テンプレートフォールバックを使用します...');
      const fallback = generateFallbackPost(notes, styles);
      postContent = fallback.content;
      slug = fallback.slug;
    }
  }

  writePost(slug, postContent);
  console.log('🎉 完了!');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
