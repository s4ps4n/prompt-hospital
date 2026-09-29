# SVG components (Stage 3)

The `Character` component accepts `worker` and `catalogEntry`, and returns a `<g>` for rendering in SVG. The local zero is the seat; the head is at (0, −44), r=17.
Default elements included: chair, desk, keyboard, and CRT monitor; dimensions are approximately (−65, −94)…(36, 40).

- `x`, `y` move the group; `motion={false}` disables all animations.
- The component respects `prefers-reduced-motion`.

For scenes with existing furniture, use `furniture={false}`. Rendering order:
1. `Character layer="body"`
2. Scene furniture
3. `Character layer="arms"` (pass `furniture={false}` to both layers)

Head placement (matching the designer's `character()`):
- Sitting: in `body` (under the desk and hands).
- Sleeping (`sleep` pose): in `arms`, after the hands (resting on the desk, on top of them).
- Hands end at (−29, 3), (−17, 7); the keyboard must be aligned with them.

`StatusScreen` is a separate component for the CRT; its local contour is (0,0), (22,5), (22,24), (0,19). The parent can transform this group.

`WorkerSign` draws a 230×66 sign (width configurable, min 180), accepts `taskTitle` from the journal via parent. Without a title, it shows the task ID or "No task". Long strings are truncated; the full text remains in the `<title>` attribute.
`StatusLamp` is available separately. All components are exported from `index.ts`.

Animation CSS is imported by components from `src/theme/animations.css`.
Palette, contour, and stroke width are shared with Stage 2: `src/theme/colors.ts`.

The scene and journal remain unchanged. Walking/coffee/sleep schedules are scene-level behaviors; this module implements the sitting sprite defined in Stage 3 requirements.
