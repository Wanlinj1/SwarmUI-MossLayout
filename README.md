# SwarmUI MOSS Layout

A visual editor for MOSS-Image Layout prompts in [SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI). Draw boxes on a canvas, describe what goes in each one, and **Apply** writes the layout prompt and sets the image size. Boxes move, scale and copy like shapes in a vector editor, and every shortcut stays listed under the canvas.

**Equal spacing.** Alt + Shift + drag copies a box in a straight line, and it snaps to the gap the other boxes already use.

![A copied box snaps to the same 120 px gap as the two boxes before it](Images/spacing.jpg)

**Distance from the edge.** A box snaps to the margin of another one, even across the canvas.

![Two boxes stand 130 px from opposite canvas edges](Images/edge.jpg)

**Groups.** Select with Ctrl + click, a Ctrl + drag frame or Ctrl+A, then move, copy or scale everything together.

![Four selected boxes inside a frame with scaling handles](Images/group.jpg)

**Characters.** MOSS boxes are rectangles, so one figure often takes several. Ctrl+G joins them into a group with one shared prompt, added to the caption of each box when you Apply, so changing a character means editing one field.

**Linked boxes.** Ctrl+L gives the selected boxes one caption: edit it in any of them and all change, while each box still moves on its own.

**Autocompletion.** Captions and shared prompts use the same completion as the Swarm prompt box, including `<...>` tags that other extensions register. An extension that does more with prompt boxes can listen for `moss-layout-prompt-field` on `document`: the event's target is each new field.

## Install

```
cd SwarmUI/src/Extensions
git clone https://github.com/Wanlinj1/SwarmUI-MossLayout
```

Then rebuild and restart SwarmUI with `launch-windows-dev.ps1` or `launch-linux-dev.sh`. The **MOSS Layout** button appears on the prompt box in the Generate tab.

## License

[MIT](LICENSE)
