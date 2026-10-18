[← All tutorials](../tutorials.md)

# File Watcher Page

This tool is useful for archivists who want to preserve their collection by monitoring it for files getting corrupted via bit rot, a bad controller, etc.

Add the base ROM directory to the File Watcher and run the first scan to hash it. Then, the following scans will verify it against the hash, letting you know if they are sound or not. You can add multiple directories to be watched and you can define exceptions for each directory or define wildcards to ignore certain files or folders. This tool scans your directory recursively, so every folder within a folder will be checked and so on.

You can also set up a schedule for this to run. Once finished, you will have a report sent to your notifications bell and a toast will notify you. This can be a set-and-forget tool, as it survives and resumes even through restarts.

It runs in the background so you don't need to be in the page when it is scanning, and you can set the speed slider to **Gentle** if you don't want your game's performance impacted when it is running the scan, or you can set it to automatically pause when you are playing games and then have it automatically resume once done.

Super useful when used in conjunction with [SMB Shares](smb-shares.md), so you can verify hashes of your master collection on your NAS!
