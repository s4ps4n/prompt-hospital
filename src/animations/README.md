# IdleDirector

SVG component to replace the sitting `Character`. Imported from `src/animations`.

Accepts: `worker`, `catalogEntry`, `lane={{ from: { x, y }, to: { x, y } }}`, and `door={{ x, y }}`. Route coordinates and the door location are relative to the chair position (`x`, `y` of the component), in SVG units, defined by the scene.

If `timeMs` is omitted, the component updates using wall-clock time (a single timeout until the next occupation boundary); the timeout is cleared on unmount, if motion is disabled, or when exiting idle state. For the scene's global timer or tests, pass `timeMs` in ms.

`idlePose` is a pure function: the cycle is walk → coffee → sleep, 45,000 ms each, with a stable shift by ID (`idHash` — FNV-1a; so neighboring `w1`, `w2` do different things at the same time). `w0` and the coordinator role are excluded.

`motion=false` disables the schedule and CSS animations, reverting to a sitting `Character`. System's `reduced-motion` Preference disables CSS animations; the character stays at the path start.

Walk and coffee are rendered using the `Standing` component (`src/characters/Standing.tsx`):
- Coordinates: feet, legs, torso, static head, hands.
- Walk: steps `stepA/stepB` + `bob`.
- Coffee: hand with cup (`sip`) and steam (`steam`).
- Sleep remains a sitting `Character`.

Walking (verified against designer's `walkLane/face/stepA/stepB/bob`):
- Walking along the corridor uses `ease-in-out` (deceleration and turning at ends).
- `face` is an instant turn at 50% progress, both with `--walk-delay` shift by ID (`walkStyle`).
- Stride: feet move (`strideA/strideB` — `translate` property, ±2 forward/backward).
- Arms cross-match legs.
- `bob` — vertical body lift on each step (twice per cycle).

Furniture remains by the chair by default; it is empty when the character is walking/drinking. `furniture=false` allows the scene to render its own furniture. The sleeping head should be rendered over the keyboard: when using external furniture, the component is placed after the desk.

The moving SVG target contains `data-drop={worker.id}`, `data-worker`, and accepts `onClick`, `onPointerDown/Up`, `onDragOver`, `onDrop`, `onKeyDown`. Pointer DnD can search for the nearest `[data-drop]` via `elementFromPoint`. Journal operations are executed by the host; the component does not call them itself. Click is also available via Enter/Space.

Integration (Stage 6): `SceneView` gets the current time from `useIdleClock` (single timeout until the next boundary among all idlers) and passes it as `timeMs`. The route and door are calculated by the scene (`idleRoute` in `src/scene/stations.ts`): walking — in the corridor, coffee — at the door inside. Sitting/sleeping/coffee drinking is rendered in the room slot (behind the front wall); the walking character is a separate object with depth-sorted coordinates.

`FLIGHT_MS`/`FLIGHT_EASE` (`flight.ts`) — envelope flight after drop; the timer and operation application occur in `src/app/useFlights.ts`.
