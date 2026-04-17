import {
  Archive,
  ArrowRight,
  Bell,
  Briefcase,
  Download,
  Inbox,
  Mail,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
} from "lucide-react";
import Image from "next/image";
import { buttonVariants } from "@/components/ui/button";

const REPO_URL = "https://github.com/nicolaslopezj/mail-samurai";
const RELEASES_URL = `${REPO_URL}/releases/latest`;

export default function Home() {
  return (
    <div className="isolate flex flex-1 flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <Hero />
        <MockupShowcase />
        <Features />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 font-semibold">
          <LogoMark />
          <span>Mail Samurai</span>
        </a>
        <nav className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <GithubIcon className="size-4" />
            GitHub
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "sm" })}
          >
            Download
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pt-24 pb-12 sm:pt-32">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" />
          Open source · MIT
        </span>
        <h1 className="mx-auto max-w-[24ch] text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          An inbox that sorts itself.
        </h1>
        <p className="mx-auto mt-6 max-w-[48ch] text-pretty text-lg text-muted-foreground">
          Mail Samurai connects to any IMAP account and uses AI to label every
          message the moment it arrives. Native macOS, open source, your keys.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg", className: "h-11 px-6" })}
          >
            <Download className="size-4" />
            Download for macOS
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: "ghost",
              size: "lg",
              className: "h-11 px-4",
            })}
          >
            View on GitHub
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

function MockupShowcase() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto w-full max-w-5xl">
        <InboxMockup />
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="border-t border-border/60 bg-muted/20 px-6 py-24">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-14 max-w-[40ch]">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Three moving parts. That&rsquo;s it.
          </h2>
          <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
            No Google review process. No proprietary sync layer. Just IMAP, your
            AI key, and a local database.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            title="AI categorization"
            description="Describe each category in plain English. An LLM tags every incoming message using your rules."
            media={<CategoriesMockup />}
          />
          <FeatureCard
            title="Bring your own model"
            description="Anthropic, OpenAI or Google. Paste an API key, pick a model, swap anytime."
            media={
              <Image
                src="/screenshots/settings-ai.png"
                alt=""
                width={1100}
                height={800}
                className="size-full object-cover object-left-top"
              />
            }
          />
          <FeatureCard
            title="Any IMAP account"
            description="Gmail, iCloud, Fastmail, self-hosted. No OAuth apps, no API quotas."
            media={<AccountsMockup />}
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  title,
  description,
  media,
}: {
  title: string;
  description: string;
  media: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border/60 bg-background p-5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10">
        {media}
      </div>
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function CTA() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="mx-auto max-w-[24ch] text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Take your inbox back.
        </h2>
        <p className="mx-auto mt-5 max-w-[48ch] text-pretty text-muted-foreground">
          Free and open source. Ship a release, read the code, or fork it.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "lg", className: "h-11 px-6" })}
          >
            <Download className="size-4" />
            Download for macOS
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: "ghost",
              size: "lg",
              className: "h-11 px-4",
            })}
          >
            <GithubIcon className="size-4" />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>Mail Samurai · MIT</span>
        </div>
        <div className="flex items-center gap-5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Issues
          </a>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            Releases
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ---------- Mockups ---------- */

type SidebarItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active?: boolean;
};

const sidebarItems: SidebarItem[] = [
  { icon: Star, label: "Important", count: 3, active: true },
  { icon: Bell, label: "Alerts" },
  { icon: Briefcase, label: "Work", count: 12 },
  { icon: ShoppingBag, label: "Shopping" },
  { icon: Tag, label: "Newsletters" },
  { icon: Inbox, label: "Other" },
];

const mails = [
  {
    from: "Ana Rivera",
    subject: "Thursday sync agenda",
    preview:
      "Sharing the deck for tomorrow — want to lock scope before the review call.",
    time: "10:41",
    tag: "Work",
    unread: true,
  },
  {
    from: "Stripe",
    subject: "Receipt from Stripe",
    preview:
      "Thanks for your payment. Your receipt #1049-2231 is attached below.",
    time: "09:12",
    tag: "Shopping",
  },
  {
    from: "GitHub",
    subject: "New pull request on mail-samurai",
    preview:
      "feat(imap): reuse connection pool across multiple mailboxes — @cora",
    time: "08:05",
    tag: "Alerts",
  },
  {
    from: "The Browser Company",
    subject: "A weekly dispatch on browsers",
    preview:
      "What we shipped this week and what we&rsquo;re thinking about next.",
    time: "yesterday",
    tag: "Newsletters",
  },
];

function InboxMockup() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-2xl shadow-black/10 outline-1 -outline-offset-1 outline-black/5 dark:outline-white/10">
      <WindowChrome title="Important · Mail Samurai" />
      <div className="grid grid-cols-[160px_280px_1fr] text-sm max-md:grid-cols-[140px_1fr]">
        <Sidebar />
        <MailList />
        <MailReader />
      </div>
    </div>
  );
}

function WindowChrome({ title }: { title: string }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border/60 bg-muted/40 px-3">
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-red-400/80" />
        <span className="size-2.5 rounded-full bg-yellow-400/80" />
        <span className="size-2.5 rounded-full bg-green-400/80" />
      </div>
      <div className="flex-1 text-center text-xs text-muted-foreground">
        {title}
      </div>
      <div className="w-11" />
    </div>
  );
}

function Sidebar() {
  return (
    <div className="flex flex-col gap-0.5 border-r border-border/60 bg-muted/30 p-2">
      <button
        type="button"
        className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium"
      >
        <Plus className="size-3.5" />
        New message
      </button>
      <p className="mt-1 px-2 pb-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
        Categories
      </p>
      {sidebarItems.map((item) => (
        <SidebarRow key={item.label} item={item} />
      ))}
      <p className="mt-3 px-2 pb-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
        Mailboxes
      </p>
      <SidebarRow
        item={{ icon: Inbox, label: "All inboxes", count: 28 }}
      />
      <SidebarRow item={{ icon: Archive, label: "Archived" }} />
    </div>
  );
}

function SidebarRow({ item }: { item: SidebarItem }) {
  const Icon = item.icon;
  return (
    <div
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-xs ${
        item.active
          ? "bg-foreground text-background"
          : "text-foreground/80 hover:bg-muted/60"
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-3.5" />
        {item.label}
      </span>
      {item.count ? (
        <span className="tabular-nums text-[0.65rem] opacity-70">
          {item.count}
        </span>
      ) : null}
    </div>
  );
}

function MailList() {
  return (
    <div className="flex flex-col border-r border-border/60 max-md:hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <p className="text-xs font-semibold tracking-tight">Important</p>
        <p className="text-[0.65rem] text-muted-foreground tabular-nums">
          24 messages
        </p>
      </div>
      <ul role="list" className="divide-y divide-border/60">
        {mails.map((mail, i) => (
          <li
            key={mail.from}
            className={`flex flex-col gap-1 px-4 py-3 ${
              i === 0 ? "bg-muted/40" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-xs font-semibold">{mail.from}</p>
              <p className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
                {mail.time}
              </p>
            </div>
            <p className="truncate text-xs text-foreground/90">
              {mail.subject}
            </p>
            <p className="truncate text-[0.7rem] text-muted-foreground">
              {mail.preview}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <CategoryPill label={mail.tag} />
              {mail.unread ? (
                <span className="size-1.5 rounded-full bg-foreground" />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MailReader() {
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">AI suggestion: </span>
        Draft a reply confirming availability and pushing the call 30 min.
      </div>
      <div>
        <p className="text-[0.7rem] text-muted-foreground tabular-nums">
          Today · 10:41
        </p>
        <p className="mt-1 text-base font-semibold tracking-tight">
          Thursday sync agenda
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[0.65rem] font-medium text-foreground">
            AR
          </span>
          <span className="text-foreground">Ana Rivera</span>
          <span>· to you</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 text-[0.78rem] leading-relaxed text-foreground/90">
        <p>Hey — sharing the deck for tomorrow&rsquo;s sync.</p>
        <p>
          I&rsquo;d love to lock scope before the review call so we don&rsquo;t
          spend the first fifteen minutes relitigating last week.
        </p>
        <p>Ana</p>
      </div>
      <div className="flex gap-2">
        <span className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-[0.7rem] font-medium">
          Reply
        </span>
        <span className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-[0.7rem] font-medium">
          Draft with AI
        </span>
      </div>
    </div>
  );
}

function CategoryPill({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium tracking-tight text-muted-foreground uppercase">
      {label}
    </span>
  );
}

/* ---- tiny mockups for feature cards ---- */

function CategoriesMockup() {
  const categories = [
    { icon: Star, label: "Important", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    { icon: Briefcase, label: "Work", color: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
    { icon: ShoppingBag, label: "Shopping", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    { icon: Bell, label: "Alerts", color: "bg-red-500/15 text-red-700 dark:text-red-300" },
    { icon: Tag, label: "Newsletters", color: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  ];
  return (
    <div className="flex size-full flex-col gap-2 bg-background p-4">
      <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
        Categories
      </p>
      <div className="flex flex-col gap-1.5">
        {categories.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
            >
              <span
                className={`inline-flex size-5 items-center justify-center rounded ${c.color}`}
              >
                <Icon className="size-3" />
              </span>
              <span className="text-xs font-medium">{c.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountsMockup() {
  const accounts = [
    { name: "Personal", provider: "iCloud", host: "imap.mail.me.com" },
    { name: "Work", provider: "Gmail", host: "imap.gmail.com" },
    { name: "Hosted", provider: "Fastmail", host: "imap.fastmail.com" },
  ];
  return (
    <div className="flex size-full flex-col gap-2 bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
          Accounts
        </p>
        <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
          <Plus className="size-2.5" />
          Add
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {accounts.map((a) => (
          <div
            key={a.name}
            className="flex items-center gap-2.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
          >
            <span className="inline-flex size-6 items-center justify-center rounded bg-foreground text-[0.6rem] font-medium text-background">
              <Mail className="size-3" />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[0.7rem] font-medium">
                {a.name}
              </span>
              <span className="truncate text-[0.6rem] text-muted-foreground">
                {a.provider} · {a.host}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
      <Mail className="size-4" />
    </span>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.96 3.22 9.16 7.69 10.65.56.1.76-.24.76-.54v-1.88c-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.64 1.23 3.28.94.1-.73.39-1.23.71-1.51-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16.9-.25 1.86-.38 2.82-.38s1.92.13 2.82.38c2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.77.54 4.46-1.49 7.68-5.69 7.68-10.65C23.25 5.48 18.27.5 12 .5z" />
    </svg>
  );
}
