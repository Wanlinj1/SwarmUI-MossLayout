using SwarmUI.Core;

namespace MossLayout;

/// <summary>Adds a visual MOSS-Image Layout editor to the Generate tab: draw boxes, caption them, and it writes the compiled layout prompt into the prompt box.</summary>
public class MossLayoutExtension : Extension
{
    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/moss_layout.js");
        StyleSheetFiles.Add("Assets/moss_layout.css");
    }
}
