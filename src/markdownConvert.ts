import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

marked.setOptions({ gfm: true, breaks: true });

let turndown: TurndownService | null = null;

function getTurndown() {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-"
    });
    turndown.use(gfm);
  }
  return turndown;
}

function inlineNodesToMarkdown(parent: ParentNode): string {
  let result = "";
  for (const node of parent.childNodes) {
    result += inlineNodeToMarkdown(node);
  }
  return result;
}

function inlineNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${inlineNodesToMarkdown(node)}**`;
    case "em":
    case "i":
      return `*${inlineNodesToMarkdown(node)}*`;
    case "del":
    case "s":
    case "strike":
      return `~~${inlineNodesToMarkdown(node)}~~`;
    case "code":
      return `\`${node.textContent ?? ""}\``;
    case "a":
      return `[${inlineNodesToMarkdown(node)}](${node.getAttribute("href") ?? ""})`;
    case "input":
      if (node.getAttribute("type") === "checkbox") {
        return `[${(node as HTMLInputElement).checked ? "x" : " "}] `;
      }
      return "";
    default:
      return inlineNodesToMarkdown(node);
  }
}

function listItemText(li: HTMLLIElement): string {
  const clone = li.cloneNode(true) as HTMLLIElement;
  clone.querySelectorAll("input[type=checkbox]").forEach((el) => el.remove());
  clone.querySelectorAll("ul, ol").forEach((el) => el.remove());
  return inlineNodesToMarkdown(clone).trim();
}

function isHashOnlyText(text: string) {
  return /^#{1,6}\s*$/.test(text.trim()) || /^#+$/.test(text.trim());
}

function listItemMarkdown(li: HTMLLIElement, orderedPrefix: string): string {
  const checkbox = li.querySelector(":scope > input[type=checkbox]");
  const prefix = checkbox instanceof HTMLInputElement
    ? `- [${checkbox.checked ? "x" : " "}]`
    : orderedPrefix;
  const text = listItemText(li);
  const nested = Array.from(li.children)
    .filter((el) => el.tagName === "UL" || el.tagName === "OL")
    .map((el) => blockNodeToMarkdown(el))
    .filter(Boolean)
    .join("\n");
  const line = text ? `${prefix} ${text}`.trimEnd() : prefix;
  return nested ? `${line}\n${nested}` : line;
}

function blockNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? "";
    return isHashOnlyText(text) ? "" : text;
  }
  if (!(node instanceof HTMLElement)) return "";

  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = node.textContent?.trim() ?? "";
      if (!text || isHashOnlyText(text)) return "";
      return `${"#".repeat(Number(tag[1]))} ${text}`;
    }
    case "p": {
      const text = inlineNodesToMarkdown(node).trim();
      return isHashOnlyText(text) ? "" : inlineNodesToMarkdown(node);
    }
    case "div":
      if (node.childNodes.length === 1 && node.firstChild?.nodeName === "BR") return "";
      if (!node.textContent && node.querySelector("br")) return "";
      {
        const text = inlineNodesToMarkdown(node).trim();
        if (isHashOnlyText(text)) return "";
        return inlineNodesToMarkdown(node);
      }
    case "ul":
      return Array.from(node.children)
        .filter((el): el is HTMLLIElement => el.tagName === "LI")
        .map((li) => listItemMarkdown(li, "-"))
        .join("\n");
    case "ol":
      return Array.from(node.children)
        .filter((el): el is HTMLLIElement => el.tagName === "LI")
        .map((li, index) => listItemMarkdown(li, `${index + 1}.`))
        .join("\n");
    case "blockquote": {
      const inner = Array.from(node.childNodes).map(blockNodeToMarkdown).join("\n").trim();
      return inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
    }
    case "pre": {
      const code = node.querySelector("code");
      const lang = code?.className.match(/language-(\S+)/)?.[1] ?? "";
      const text = (code ?? node).textContent ?? "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "table":
      return getTurndown().turndown(node.outerHTML).trim();
    case "hr":
      return "---";
    default:
      return inlineNodesToMarkdown(node);
  }
}

export function normalizeMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";
  return markdown
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !/^#{1,6}\s*$/.test(block) && !/^#+$/.test(block))
    .join("\n\n");
}

export function domToMarkdown(root: HTMLElement): string {
  const parts: string[] = [];
  for (const node of root.childNodes) {
    const md = blockNodeToMarkdown(node);
    if (md) parts.push(md);
  }
  return normalizeMarkdown(parts.join("\n\n"));
}

export function markdownToEditableHtml(markdown: string) {
  if (!markdown.trim()) return "";
  const html = marked.parse(markdown, { async: false }) as string;
  return html.replace(/<input([^>]*?)disabled(?:=""|\s)?([^>]*?)>/gi, "<input$1$2>");
}

export function htmlToMarkdown(html: string) {
  const trimmed = html.replace(/<br>\s*$/, "").trim();
  if (!trimmed) return "";
  const container = document.createElement("div");
  container.innerHTML = trimmed;
  return domToMarkdown(container);
}
