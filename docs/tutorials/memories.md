[← All tutorials](../tutorials.md)

# Memories Page

Memories is a feature that allows you to take screenshots or video clips of your game, which are then stored as memories under the Memories page per game. Any achievements you obtain within the window will be attached to it, so when viewing the memory you can view your list of achievements. For video clips, you can even watch the clip and see which achievements you've unlocked in real time using Timeline Play.

## How it Works

Memories actually integrates with SteamOS' screenshots and video recording, so when you take a screenshot or video clip, Memories is notified and copies it to its own directory. The SteamOS copy is still untouched, but if you want to set it up so it deletes it after the copy, go to **Quick Menu > [Options](options.md) > System Tab > Memories** and look for **Delete Source Screenshot** and **Delete Source Clip**. Toggle them both to **On**, so from now on, memories will only exist in CheevoDeck. It's left off by default just in case users want to keep their Steam screenshots and clips too.

## How to Enable

When you first go to the Memories page (the third button from the left under the current game's info on the main page), you will see the toggle there. Simply toggle it on to enable the feature. You can also enable it by going to **Quick Menu > Options > System Tab > Memories** and then toggling **Enable Memories** to **On**.

Also, if you plan to save video clips as Memories, make sure to enable recording in SteamOS. To do so, press the **Steam** button **> Settings > Game Recording** and then either select **Record in Background** or **Record Manually**.

By default, for screenshots, SteamOS saves compressed JPEG files. If you want to save uncompressed PNG files, go to Desktop Mode, right click (**R2** or right trackpad click) the Steam icon in the lower right corner, and then **Settings > In Game > Screenshots** and toggle **Save an external copy of my screenshots** to **On**. It defaults to your Documents folder, but you can change the location below if you'd like. Once you do this, they will be saved as high-quality uncompressed PNGs. Not really needed, and it is fine with the default JPEG, but I figured I'd bring it up for the quality freaks out there like me.

## How to Pause it

Memories will draw in SteamOS screenshots and clips and put them in your Memories page for the current game, but what if you are playing a Steam game, not a RetroAchievements game? Luckily, you don't need to pause Memories here, as when taking a memory, it first checks that you are playing a non-Steam game, so you don't have to worry about Memories drawing in screenshots from your Steam games.

But what if you are playing a non-Steam game that isn't supported by RA and you want to take screenshots but don't want them to fall under Memories? Go to the Quick Menu and simply toggle on **Standby**. This not only shuts down the CheevoDeck social services and others, but it disables the Memories service temporarily. Once you start your next RA game and want to use CheevoDeck again, simply toggle **Standby** back off.

## How to take a screenshot memory

While in your game, to take a screenshot memory, press the default combo on your controller that SteamOS uses for screenshots. Usually, it is **Steam + R1**, but this can vary depending on your device and the controller you are using. To know for sure, simply hold down the Steam button or Steam button equivalent, and then select **Show Controller Shortcuts**. Look for the **Take Screenshot** combo.

Simply pressing this combo during the game will take the screenshot and capture it as a memory. Taking the screenshot within 60 seconds of an achievement will grab and attach the achievement info to it.

## How to take a video clip memory

This assumes video recording is enabled in SteamOS. See the [How to Enable](#how-to-enable) section above on how to enable recording.

It's similar to taking a screenshot memory, but requires a few more steps, though nothing too complex. There are two methods for this: the first is manual recording, where you start the recording and then you stop the recording and it is then added to the Memories page, and then there is grabbing and clipping footage from continuous recording. This is useful if there was a cool cutscene you watched and you want to go back and edit and clip the continuous footage through Steam's editor.

**Manual Memory Clip:** In your game, when you want to start recording, simply press Steam's default button combo for **Toggle Manual Recording**. Once you are done recording, press that same combo to end the recording, and then it is automatically added to your Memories. Usually, it is **Steam + A**, but this can vary depending on your device and the controller you are using. To know for sure, simply hold down the Steam button or Steam button equivalent, and then select **Show Controller Shortcuts**. Look for the **Toggle Manual Recording** combo. Any achievements that you unlocked during the recording will be added to the memory.

**Grabbing a clip from continuous recording:** Useful if you witnessed something really neat in a game or did something really cool but you couldn't capture the moment. If you have continuous recording enabled in SteamOS (see above), you can luckily view your footage and clip out what you want from it, and then CheevoDeck will pull it in and add it to Memories with any achievements unlocked during that time as well. To do so, during your game, press the Steam button or equivalent, then under the game menu, choose **Game Recording**. Then choose **View Background Recording**, then use the interface here to make the clip you would like to save. Once saved here, it will then show up in your Memories page for the current game.

## Viewing Memories

To view your memories, simply select the third button from the left under the current game info on the main page. It will default to showing memories for your current game, but you are free to change games in the filter here. Look in the grid and select the memory you want to view. Press **A** on it to enter the viewer. Depending on whether your memory was a video clip or screenshot, the viewer will have different options:

### Screenshot Memory Viewer

- Pressing **A** on the screenshot shows it in fullscreen mode.
- **Edit:** Here you can give it a tag that can be used for you to filter it on the Memories page. The tag is also used if you share it. You can also give it a caption, which appears under your memory and can be used when sharing, as well as a color coding, which is also used for filtering.
- **Share:** Integrates with Discord to share the memory to the #shared-memories section.

### Video Clip Memory Viewer

- Pressing **A** on the video starts the video in fullscreen. See the bar at the bottom for controls for fast-forward, rewind, skip, bookmark, etc.
- **Timeline Play:** Only available if you have achievements attached to the memory. It will play the video and show in real time which achievements you unlocked as the video plays.
- **Bookmark:** While the video is playing in Timeline Play or fullscreen mode, if you press **Start**, a bookmark will be added below the video that starts at that spot. Feel free to make multiple bookmarks and then later go back to the bookmark to give it a label. When you press **A** on a bookmark, it starts the clip at the exact time.
- **Edit:** Here you can give it a tag that can be used for you to filter it on the Memories page. The tag is also used if you share it. You can also give it a caption, which appears under your memory and can be used when sharing, as well as a color coding, which is also used for filtering.
- **Share:** Integrates with Discord to share the memory to the #shared-memories section. If you're over a bookmark and press **R2**, it will open the share dialog at that bookmark.
- **Snippet:** When over a bookmark, pressing **L1** opens a dialog to save that snippet to a location of your choice on your device.

## Sharing Memories

Sharing memories integrates with the CheevoDeck browser and Discord, and it is made easy for you: your post is filled out for you and all you have to do is press Post. Either share a memory by pressing **R2** on a memory in the Memories page or by selecting the share button when viewing a memory in the viewer.

Once you select to share it, the sharing dialog will appear. If it's a video clip memory, you can only share a max of 30 seconds of your clip, so use the editor to set the start and the end of the clip. Use the right stick to seek in small steps through the clip, or **L2** and **R2** to fast forward in bigger chunks. Then press **L1** and **R1** to set the beginning and end of the clip. If it's a screenshot, there's nothing to do here.

After this, the default caption you gave the memory will appear in the Caption field to be used in the shared memory post. If you want a custom caption, press clear and enter your new caption. The tag that you gave your memory will be included in the post, but here you can select from 3 additional tags.

Finally, select whether you want your RA username to be included in the post. This is on by default. Then select whether or not you want to include your profile on the media itself. If enabled, it will show your RA avatar and username baked into the upper right corner of the video or image. Useful for when people are browsing the gallery and want to see whose memory that is. Finally, you can select whether or not to show your [Milestones](milestones.md) badge on the media too. This is if you want bragging rights to show off your current Milestones rank.

The final step after everything above is done is to select **Post**. It'll take a little bit to encode the video if it is a full 30-second clip, but not too long. After this, it will open up the custom CheevoDeck [browser](utilities.md#web-browser) and go straight to the CheevoDeck Discord channel #shared-memories, fill in everything for your post and attach the clip or screenshot. All you have to do is press post and you are good to go!

## Viewing Shared Memories

In the Memories page, simply select the first button on the left under the "Memories (x)" subheader. It's the button with the group icon on it. Once pressed, it opens up CheevoDeck's custom browser directly to the shared memories page, where you can view others' memories and comment on them if you'd like.

## Filter Memories

In the Memories page, you can filter your memories for your currently selected game. You can filter by the tags and color codes you give them, as well as media type. So if you wonder where your memories went, be sure to check the filter, as you might have left it on a certain criteria from before.

Setting the tag filter to **All**, the color filter to the first option, and media type to **All** will basically remove all filters and show everything. You can also simply select the **Reset Filter** button at the bottom to clear it.

## Saving Media

If you want to save the clip or screenshot to a location on your device, in the Memories page, press **R1** over the memory to save it to a location of your choice.

**Pro Tip:** You can map actions to open the Memories page, or open your last captured memory in the viewer, to the buttons on your controller. By default, **L4** or **Menu + D-Pad Left** opens your last captured memory; **L5** or **Menu + D-Pad Right** opens the Memories page. By default, these only work when you are within the Quick Access Menu in CheevoDeck, but you can extend this to work outside of it, with it closed while playing your game. To do so, go to the Quick Menu and then toggle **Global Buttons** on. Now, it will work wherever. You can customize the combo in **Quick Menu > Options > System Tab > Mapped Shortcuts**.
