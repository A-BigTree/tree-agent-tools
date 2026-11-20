import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, theme } from "herdr";

const MARKS = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};

const FALLBACK = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];

export function Icon(name, size = 14) {
  return svg(`mods/multi-repo-sidebar/icons/${name}.svg`).size(size).flex_none();
}

export function ProgramIcon(program, size = 14) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(size).flex_none()
    : image(program.icon).w(size).h(size).flex_none();
}

export function colorForSpace(space) {
  const colors = shared("space.colors") ?? {};
  const stored = colors[space.id];
  if (typeof stored === "string" && stored.startsWith("#")) return stored;
  if (stored && MARKS[stored]) return MARKS[stored];
  let hash = 0;
  for (const character of String(space.name ?? space.id ?? "")) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return FALLBACK[hash % FALLBACK.length];
}

export function Avatar(space, size = 18) {
  return div()
    .size(size)
    .flex_none()
    .rounded(5)
    .bg(colorForSpace(space))
    .flex()
    .items_center()
    .justify_center()
    .text_size(size * 0.58)
    .font_bold()
    .text_color("#ffffff")
    .child([...String(space.name || "?")][0]?.toUpperCase() ?? "?");
}

export function CountPill(count) {
  const t = theme();
  return h_flex()
    .flex_none()
    .h(16)
    .px(5)
    .rounded(4)
    .bg(t.raised)
    .text_size(10)
    .text_color(t.muted)
    .items_center()
    .child(String(count));
}

export function Status(t, status) {
  if (!status) return div().size(7).flex_none();
  if (status === "working")
    return svg("mods/multi-repo-sidebar/icons/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
  if (status === "blocked")
    return div()
      .flex_none()
      .size(14)
      .rounded(4)
      .bg(`${t.blocked}26`)
      .text_size(10)
      .font_bold()
      .text_color(t.blocked)
      .flex()
      .items_center()
      .justify_center()
      .child("!");
  if (status === "done") return div().size(7).flex_none().rounded(4).bg(t.done ?? t.working);
  return div().size(7).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}

export function Rail(kind) {
  const t = theme();
  const line = () => div().absolute().left(5).border_color(t.border);
  return div()
    .relative()
    .w(12)
    .flex_none()
    .self_stretch()
    .when(kind === "│" || kind === "├", (el) => el.child(line().top(0).bottom(0).border_l(1)))
    .when(kind === "├" || kind === "└", (el) =>
      el.child(line().top(0).h(13).w(6).border_l(1).border_b(1).rounded_bl(4)),
    );
}

export function IconButton({ id, icon, label, onClick, iconSize = 14 }) {
  const t = theme();
  return div()
    .id(id)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .text_color(t.muted)
    .cursor_pointer()
    .tooltip(label)
    .hover((style) => style.bg(t.hover).text_color(t.foreground))
    .on_click((_event, cx) => {
      cx.stop_propagation();
      onClick(cx);
    })
    .child(Icon(icon, iconSize));
}
