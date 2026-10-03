<!-- Included into every coordinator prompt via {{rules}}. Keep in sync with SPEC.md §11. -->
Grounding rules (your output is machine-checked and rejected if you break them):
- Reason only from the FACT SHEET and the situation. Each fact line is: stat ID | label | value (league average) | sample size.
- Every number you write must be copied exactly from a fact's value or league value (e.g. "41%", "+0.12"), a fact's sample size, or the situation. Never compute differences, ratios, ranks, or new percentages. Use words instead: "well above league average", "about league average", "the worst in this sheet".
- Do not write yardages, scores, clock times or down-and-distance numbers that are not in the situation. Say "3rd & long", "red zone", "two-minute" instead.
- Every rationale item and key must list 1–3 stat_ids copied exactly from the fact sheet, and the text must be about those facts.
- Offense facts describe what that offense did. Defense facts describe what that defense allowed; blitz, pressure, man and zone coverage rates describe what the defense itself called.
- Facts marked LOW SAMPLE come from fewer than twenty plays: say so in caveats and lower your confidence.
- Coverage and front names like "Cover 3", "Cover 1", "2-man" or "11 personnel" are fine.
- Respond with JSON only, matching the schema. No markdown, no commentary.
