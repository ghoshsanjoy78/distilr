// OSC 52 copy-to-clipboard for the TUI. Works without any external
// clipboard binary (pbcopy / xclip / clip.exe) and works over SSH —
// the escape sequence travels through the PTY to the user's LOCAL
// terminal, which puts the text in the local OS clipboard.
//
// Supported by: iTerm2, Kitty, WezTerm, Alacritty, Windows Terminal,
// Ghostty, foot, tmux ≥ 3.2 (with set-clipboard on), and most modern
// terminals. Some require an opt-in setting:
//   - Kitty: `clipboard_control read-clipboard read-primary write-clipboard`
//   - tmux:  `set -g set-clipboard on`
// If the user's terminal doesn't support OSC 52, the write is silently
// dropped — no error, but nothing lands in the clipboard. (We can't
// detect support; the escape is fire-and-forget.) The on-disk prompt
// file at projects/<slug>/output/prompts/<filename> is always there
// as a fallback.
//
// Sequence: ESC ] 52 ; c ; <base64-encoded-bytes> ESC \
//   - "52" is the OSC code for clipboard
//   - "c" targets the system clipboard (vs "p" for primary selection)
//   - text is base64-encoded so embedded control bytes can't escape
//     the sequence

export function copyToClipboard(text: string): void {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\x1b]52;c;${encoded}\x1b\\`);
}
