**Title:**
Duplicate tags are added when using 'Apply Folder Tags to Notes' after updating folder tags in TagIt plugin

**Description:**

- **Summary:**
  When using the 'Apply Folder Tags to Notes' feature in the TagIt plugin for Obsidian, if the folder's tags have been updated, applying the folder tags to notes results in duplicate tags in the notes' YAML front matter. This duplication occurs even if the notes already contain the folder tags, leading to redundant and cluttered tags after each update.

- **Expected Behavior:**
  The plugin should check the existing tags in each note and only apply the new or missing folder tags. If a tag from the folder is already present in a note's YAML front matter, it should not be added again. This ensures that when updating folder tags (e.g., adding a new tag), the 'Apply Folder Tags to Notes' feature will only apply the new tags to notes that don't already have them.

- **Actual Behavior:**
  Upon updating the folder's tags and using the 'Apply Folder Tags to Notes' feature, the plugin re-applies all the folder tags to the notes without checking for existing tags. This results in multiple instances of the same tags in the notes' YAML front matter, creating duplicates each time the feature is used after a folder tag update.

**Steps to Reproduce:**

1. **Setup:**

   - Open Obsidian v1.7.4 on macOS.
   - Ensure the TagIt plugin v1.0 is installed and enabled.
   - Create a new folder (e.g., **"Folder A"**).
   - Assign initial tags to **"Folder A"** (e.g., `tag1`, `tag2`).

2. **Initial Application:**

   - Create one or more notes within **"Folder A"**.
   - Use the **'Apply Folder Tags to Notes'** feature on **"Folder A"**.
   - **Observation:** The notes now have `tag1` and `tag2` in their YAML front matter. No duplicates are present at this stage.

3. **Update Folder Tags:**

   - Add a new tag to **"Folder A"**'s tags (e.g., `tag3`), so the folder now has `tag1`, `tag2`, `tag3`.

4. **Reapply Folder Tags:**

   - Use the **'Apply Folder Tags to Notes'** feature again on **"Folder A"**.
   - **Observation:** The notes now have duplicate entries of `tag1`, `tag2`, and the new `tag3` is added. The YAML front matter shows multiple instances of `tag1` and `tag2`.

5. **Repeat the Process (Optional):**
   - Each time the folder's tags are updated and the 'Apply Folder Tags to Notes' feature is used, duplicates of all folder tags are added to the notes.

**Environment:**

- **TagIt Plugin Version:** v1.0
- **Obsidian Version:** v1.7.4
- **Operating System:** macOS (e.g., macOS Monterey 12.0.1)
- **Device:** MacBook Pro (please specify model/year if possible)

**Attachments:**

1. **Terminal Output Logs:**

   ```
   plugin:obsidian-tagit:740 Current folder tags: ally, is, great, aswell, two
   plugin:obsidian-tagit:749 Processing file: Note1.md
   plugin:obsidian-tagit:753 Existing tags: ally, aswell, great, is, two
   plugin:obsidian-tagit:758 Updated tags: ally, aswell, great, is, two
   plugin:obsidian-tagit:768 No changes needed for file: Note1.md
   ...
   plugin:obsidian-tagit:1014 Saved tags for folder Ally: ally, is, great, aswell, two, three
   plugin:obsidian-tagit:740 Current folder tags: ally, is, great, aswell, two, three
   plugin:obsidian-tagit:749 Processing file: Note1.md
   plugin:obsidian-tagit:753 Existing tags: ally, aswell, great, is, two
   plugin:obsidian-tagit:758 Updated tags: ally, aswell, great, is, two, three
   plugin:obsidian-tagit:765 Updated tags for file: Note1.md
   ```

2. **Screenshots:**

   - _Screenshot showing the YAML front matter of a note before and after applying the folder tags, highlighting the duplicate tags._

3. **Sample YAML Front Matter Before and After:**

   **Before Applying Folder Tags:**

   ```yaml
   ---
   tags:
     - tag1
     - tag2
   ---
   ```

   **After Applying Folder Tags Again (Duplicates Present):**

   ```yaml
   ---
   tags:
     - tag1
     - tag2
     - tag1
     - tag2
     - tag3
   ---
   ```

**Additional Information:**

- The issue specifically occurs after updating the folder's tags and reapplying them to notes.
- The duplication happens consistently every time the folder tags are updated and the 'Apply Folder Tags to Notes' feature is used.
- No error messages are displayed when the duplication occurs.
- This behavior leads to cluttered YAML front matter, which can affect tag-based searches and organizational workflows.
- The problem does not occur when the 'Apply Folder Tags to Notes' feature is used for the first time on notes without the folder tags.

**Priority/Severity:**

- **Medium Severity:** While the plugin remains functional, the duplication of tags can cause confusion, reduce efficiency, and potentially impact users who rely heavily on accurate tagging for note organization and retrieval.

**Recommendations:**

- **Tag Deduplication Logic:** Implement a check within the 'Apply Folder Tags to Notes' feature to compare the folder's tags with the existing tags in each note's YAML front matter. Only add tags that are not already present.

- **Update Feedback:** Provide a message or log entry indicating that tags have been updated without duplication.

- **Testing:** After implementing the fix, test the feature by updating folder tags multiple times and reapplying them to notes to ensure duplicates are no longer created.

**Thank You:**

Thank you for your attention to this matter. Addressing this issue will greatly enhance the usability of the TagIt plugin for users who frequently update folder tags and rely on accurate tagging for their notes.

If you need any further information or assistance in reproducing the issue, please feel free to contact me.
