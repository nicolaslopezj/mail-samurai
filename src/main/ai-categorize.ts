import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import {
  type AiProvider,
  type Category,
  type MessageWithBody,
  SUMMARY_LANGUAGES,
  type SummaryLanguage
} from '../shared/settings'

export type CategorizationResult = {
  /** The matched category id, or `null` when no category applies. */
  categoryId: string | null
  /** One-sentence rationale from the model — useful for debugging / UI tooltip. */
  reason: string
  /**
   * One-sentence gist of the email, written in the email's own language.
   * Shown in the message list in place of the raw snippet.
   */
  summary: string
}

/**
 * Ask the configured LLM which user-defined category an email belongs to.
 * Returns the chosen category id, or `null` when the model decided nothing fits.
 *
 * The model is given:
 *   - the list of categories (name + free-form instructions)
 *   - the email (from / subject / plain-text body, truncated)
 * and must pick exactly one id from the allow-list, or the sentinel
 * `__none__` to mean "no category".
 */
export async function categorizeMessage(
  message: MessageWithBody,
  categories: Category[],
  allowUncategorized: boolean,
  provider: AiProvider,
  modelId: string,
  apiKey: string,
  summaryLanguage: SummaryLanguage = 'auto'
): Promise<CategorizationResult> {
  if (categories.length === 0) {
    return { categoryId: null, reason: 'No categories are configured.', summary: '' }
  }

  const forcedLanguage =
    SUMMARY_LANGUAGES.find((l) => l.value === summaryLanguage)?.promptName ?? ''

  const NONE = '__none__'
  const categoryIds = categories.map((c) => c.id)
  const allowedIds = allowUncategorized ? [NONE, ...categoryIds] : categoryIds
  // `language` comes FIRST on purpose: forcing the model to declare the email's
  // language before writing the summary reliably keeps summaries in the right
  // language (without this field the model tends to drift to the user's locale).
  const schema = z.object({
    language: z.string(),
    summary: z.string(),
    categoryId: z.enum(allowedIds as [string, ...string[]]),
    reason: z.string()
  })

  const model = buildModel(provider, modelId, apiKey)

  const categoriesBlock = categories
    .map(
      (c) => `- id: ${c.id}
  name: ${c.name}
  rule: ${c.instructions.trim() || '(no rule provided — do not match this category)'}`
    )
    .join('\n')

  const bodyText = extractBodyText(message)
  const emailBlock = `From: ${formatSender(message)}
Subject: ${message.subject ?? '(no subject)'}

${bodyText}`

  // Bias toward "no match": the default is uncategorized, and a category is
  // picked only when the user's rule clearly fits. Without this framing models
  // tend to pick the "closest" category even when none actually match, which
  // pollutes the category views and empties the Inbox.
  const languageRule = forcedLanguage
    ? `1. \`language\`: always output exactly "${forcedLanguage}" — the user
   configured this as their preferred summary language.

2. \`summary\`: write this ENTIRELY in ${forcedLanguage}, regardless of the
   email's original language. Translate if needed.
   - Exactly ONE short sentence on a single line. No line breaks, no bullets,
     no headings, no markdown. Under 200 chars.
   - Factual gist: what the email is about and what it asks for / announces.
     No marketing fluff, no greetings, no signatures.`
    : `1. \`language\`: detect the predominant language of the email body and output
   its English name (e.g. "English", "Spanish", "Portuguese", "French"). Use
   the body, not the user's locale, not your own default. If the body mixes
   languages, pick the dominant one.

2. \`summary\`: write this in the language you just declared in \`language\`.
   Do NOT translate into any other language under any circumstance.
   - Exactly ONE short sentence on a single line. No line breaks, no bullets,
     no headings, no markdown. Under 200 chars.
   - Factual gist: what the email is about and what it asks for / announces.
     No marketing fluff, no greetings, no signatures.`

  const categoryRule = allowUncategorized
    ? `3. \`categoryId\`:
   - The DEFAULT outcome is "${NONE}" (no category). Most emails belong here.
   - Only pick a category when the email clearly and specifically matches
     that category's rule. Surface-level topical similarity is NOT enough.
   - If you are unsure, or if more than one category could plausibly fit,
     return "${NONE}".
   - Never invent a category id. Pick from the provided list or use
     "${NONE}".`
    : `3. \`categoryId\`:
   - You MUST choose exactly one real category id from the provided list.
   - Never return "${NONE}" and never leave the field empty.
   - Pick the single best match based on the user's rules, even when the fit
     is weak or more than one category could plausibly apply.
   - Never invent a category id.`

  const system = `You route incoming email into user-defined categories and
write a short summary of each email.

Fill the fields in this order — each one depends on the previous.

${languageRule}

${categoryRule}

4. \`reason\`: one sentence (under 240 chars) stating which rule matched
   (and why), or why no rule matched. This field may be in English.`

  const categoriesPrompt = allowUncategorized
    ? `Categories (id "${NONE}" means "no category fits"):
- id: ${NONE}
  name: Uncategorized
  rule: Use this whenever no category below clearly matches.
${categoriesBlock}`
    : `Categories:
${categoriesBlock}`

  const closingInstruction = allowUncategorized
    ? `Think: does the email clearly satisfy any rule above? If not, return "${NONE}".`
    : 'Think: which single category is the best match for this email?'

  const prompt = `${categoriesPrompt}

Email to classify:
"""
${emailBlock}
"""

${closingInstruction}`

  const { object } = await generateObject({
    model,
    schema,
    system,
    prompt
  })

  return {
    categoryId: object.categoryId === NONE ? null : object.categoryId,
    reason: object.reason,
    summary: normalizeSummary(object.summary)
  }
}

/** Collapse the model's summary to a single trimmed line. */
function normalizeSummary(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ')
}

function buildModel(provider: AiProvider, modelId: string, apiKey: string) {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
  }
}

function formatSender(message: MessageWithBody): string {
  if (!message.from) return '(unknown)'
  const { name, address } = message.from
  return name ? `${name} <${address}>` : address
}

/**
 * Pick the best text representation of the email for the model.
 * Prefer plain-text; fall back to a stripped HTML body. Cap length to keep
 * token usage and latency predictable — 8k chars is comfortable headroom
 * even for small-context models.
 */
function extractBodyText(message: MessageWithBody): string {
  const MAX = 8000
  if (message.bodyText?.trim()) {
    return truncate(message.bodyText, MAX)
  }
  if (message.bodyHtml) {
    const stripped = message.bodyHtml
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return truncate(stripped, MAX)
  }
  return message.snippet ?? ''
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated]`
}
