/**
 * Centralized UI Utility Functions
 * Consolidates repeated HTML generation, formatting, and styling logic
 */
export class UIUtility {
    // Swimlane band colors. CSS variables (defined in roadmap-styles.css)
    // so dark mode can override without touching the renderer. These get
    // injected as inline styles by the generator, so the var() lookup
    // happens at render time against whichever scheme is active.
    static COLORS = {
        LIME_BACKGROUND: 'var(--rm-swimlane-even)',
        BROWN_BACKGROUND: 'var(--rm-swimlane-odd)',
    };

    /**
     * Calculate alternating background color based on visual position
     * @param {number} visualPosition - Position in the visual layout (0-based)
     * @returns {string} - Background color hex code
     */
    static getAlternatingBackgroundColor(visualPosition) {
        return visualPosition % 2 === 0
            ? this.COLORS.LIME_BACKGROUND
            : this.COLORS.BROWN_BACKGROUND;
    }

    /**
     * Sanitize a string for use as CSS selector/ID
     * @param {string} text - Text to sanitize
     * @returns {string} - CSS-safe string with only alphanumeric and hyphens
     */
    static sanitizeForCSS(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/[^a-zA-Z0-9]/g, '-');
    }

    /**
     * Generate a unique story ID for CSS selectors
     * @param {string} epicName - Name of the epic
     * @param {number} storyIndex - Index of the story
     * @returns {string} - Unique story ID
     */
    static generateStoryId(epicName, storyIndex) {
        return `story-${this.sanitizeForCSS(epicName)}-${storyIndex}`;
    }

    /**
     * Generate edit icon HTML for embedded mode
     * @param {boolean} embedded - Whether in embedded mode
     * @param {string} epicName - Name of the epic
     * @param {string} storyTitle - Title of the story
     * @param {number} storyIndex - Index of the story
     * @param {Function} formatTextFn - Function to format text (usually this.formatText)
     * @returns {string} - Edit icon HTML or empty string
     */
    static generateEditIconHTML(embedded, epicName, storyTitle, storyIndex, formatTextFn) {
        if (!embedded) return '';

        const safeEpicName = formatTextFn(epicName);
        const safeStoryTitle = formatTextFn(storyTitle);

        return `<div class="edit-icon" onclick="parent.openEditStoryModal({epicName: '${safeEpicName}', storyTitle: '${safeStoryTitle}', storyIndex: ${storyIndex}})" title="Edit Story">✎</div>`;
    }

    /**
     * Generate bullets HTML list
     * @param {Array} bullets - Array of bullet point strings
     * @param {Function} formatTextFn - Function to format text (usually this.formatText)
     * @returns {string} - Bullets HTML or empty string
     */
    static generateBulletsHTML(bullets, formatTextFn) {
        if (!bullets || !Array.isArray(bullets) || bullets.length === 0) return '';

        const bulletItems = bullets
            .map((bullet) => {
                const trimmedBullet = bullet.trim();
                // Convert --- to spacing div instead of bullet point
                if (trimmedBullet === '---') {
                    return '</ul><div style="height: 12px;"></div><ul class="task-bullets" style="display: block; visibility: visible;">';
                }

                // Format the bullet text and fix div tags that cause line breaks
                let formattedBullet = formatTextFn(bullet);
                // Convert div tags to span tags to prevent line breaks in bullets
                formattedBullet = formattedBullet.replace(/<div(\s[^>]*)?>/g, '<span$1>');
                formattedBullet = formattedBullet.replace(/<\/div>/g, '</span>');

                return `<li style="margin: 0 0 3px 0; padding: 0; display: list-item; visibility: visible;">${formattedBullet}</li>`;
            })
            .join('');

        return `<ul class="task-bullets" style="display: block; visibility: visible;">${bulletItems}</ul>`;
    }

    /**
     * Clean and normalize text by removing excessive whitespace
     * @param {string} text - Text to clean
     * @returns {string} - Cleaned text
     */
    static cleanWhitespace(text) {
        if (!text || typeof text !== 'string') return '';

        return text
            .replace(/[\r\n\t\f\v]/g, '') // Remove all line breaks and tabs
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim(); // Remove leading/trailing spaces
    }

    /**
     * Truncate text to specified length with ellipsis
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length before truncation
     * @returns {string} - Truncated text with '...' if needed
     */
    static truncateText(text, maxLength) {
        if (!text || typeof text !== 'string') return '';
        if (text.length <= maxLength) return text;

        const truncated = text.substring(0, maxLength - 3).replace(/\s+$/, '');
        return truncated + '...';
    }

    /**
     * Clean and truncate epic name based on story count
     * @param {string} name - Epic name to process
     * @param {number} numStories - Number of stories in epic (affects truncation length)
     * @returns {string} - Cleaned and appropriately truncated name
     */
    static processEpicName(name, numStories = 1) {
        if (!name) return name;

        // Clean the name first
        const cleanName = this.cleanWhitespace(name);

        // Determine truncation limit based on epic height (number of stories)
        let maxLength;
        if (numStories === 1) {
            maxLength = 7; // < 8 characters for single story EPICs
        } else if (numStories === 2) {
            maxLength = 14; // < 15 characters for 2-story EPICs
        } else if (numStories === 3) {
            maxLength = 23; // 3-story EPICs
        } else if (numStories === 4) {
            maxLength = 30; // 4-story EPICs
        } else {
            // 5+ stories: NO TRUNCATION LIMIT
            return cleanName;
        }

        return this.truncateText(cleanName, maxLength);
    }

    /**
     * Generate data attributes for story elements
     * @param {string} epicName - Name of the epic
     * @param {string} storyTitle - Title of the story
     * @param {number} storyIndex - Index of the story
     * @param {string} storyId - Unique story ID
     * @param {Function} formatTextFn - Function to format text
     * @returns {string} - Data attributes HTML
     */
    static generateStoryDataAttributes(epicName, storyTitle, storyIndex, storyId, formatTextFn) {
        return `data-epic-name="${formatTextFn(epicName)}" data-story-title="${formatTextFn(storyTitle)}" data-story-index="${storyIndex}" data-story-id="${storyId}"`;
    }

    /**
     * Normalize month string for comparison
     * @param {string} month - Month string to normalize
     * @returns {string} - Uppercase month string
     */
    static normalizeMonth(month) {
        return month ? month.toUpperCase() : '';
    }
}
