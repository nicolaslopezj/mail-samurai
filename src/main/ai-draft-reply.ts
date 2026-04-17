import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type {
  AiProvider,
  AiReplyPreferences,
  EmailAddress,
  MessageWithBody
} from '../shared/settings'

export type DraftReplyInput = {
  /** The message being replied to / forwarded. `null` = compose from scratch. */
  source: MessageWithBody | null
  /** Free-form instruction from the user ("agree and propose Tue 3pm"). */
  userPrompt: string
  /**
   * Mode the compose dialog is in — lets the model match the expected tone
   * (e.g. a forward body vs. a reply body).
   */
  mode: 'new' | 'reply' | 'replyAll' | 'forward'
  /** Who will send the mail (so the model signs off correctly). */
  from: EmailAddress
  /** Whatever the user has already typed in the editor, stripped to text. */
  existingBodyText: string
  /** User's persistent style/tone/signature preferences from Settings. */
  preferences?: AiReplyPreferences
}

export async function draftReply(
  input: DraftReplyInput,
  provider: AiProvider,
  modelId: string,
  apiKey: string
): Promise<string> {
  const model = buildModel(provider, modelId, apiKey)

  const sourceBlock = input.source
    ? `Original message being ${input.mode === 'forward' ? 'forwarded' : 'replied to'}:
From: ${formatSender(input.source)}
Subject: ${input.source.subject ?? '(no subject)'}

${extractBodyText(input.source)}`
    : '(No source message — this is a brand-new email.)'

  const draftBlock = input.existingBodyText.trim()
    ? `The user has already drafted this, keep/refine it rather than throwing it away:
"""
${truncate(input.existingBodyText.trim(), 4000)}
"""`
    : '(The editor is empty — write the full body.)'

  const senderName = input.from.name?.trim() || input.from.address.split('@')[0]

  const instructions = input.preferences?.instructions.trim()

  const system = `You write email bodies on behalf of the user. Output ONLY the
body the user should send — no subject line, no greeting prefix like "Body:",
no explanation, no markdown fences.

Style rules:
- Match the language of the original message (or the user's instruction if
  there is no source message).
- Keep the tone natural and concise — a real person writing, not a corporate
  template. No filler like "I hope this email finds you well" unless the
  user explicitly asks for it.
- Do not invent facts, dates, names, amounts, or commitments that aren't in
  the user's instruction or the original message. If something is missing,
  leave a clearly marked placeholder like [date] or ask inside the reply.
- Do not quote the original message back — the email client appends the
  quote automatically below your output.
- Sign off with the sender's first name (${senderName}) unless the user's
  instructions or per-reply instruction tell you otherwise.
- Use plain paragraphs separated by blank lines. No bullet lists unless the
  user asks for them.${
    instructions
      ? `\n\nUser's persistent preferences — obey whenever they don't contradict the per-reply instruction below:\n${instructions}`
      : ''
  }`

  const prompt = `${sourceBlock}

${draftBlock}

User's instruction for how to write the reply:
"""
${input.userPrompt.trim() || '(no extra instruction — use your judgement)'}
"""

Write the email body now.`

  const { text } = await generateText({
    model,
    system,
    prompt
  })

  return text.trim()
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

function extractBodyText(message: MessageWithBody): string {
  const MAX = 6000
  if (message.bodyText?.trim()) return truncate(message.bodyText, MAX)
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
