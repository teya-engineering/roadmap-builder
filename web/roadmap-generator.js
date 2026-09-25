import { DateUtility } from './utilities/date-utility.js';
import { UIUtility } from './utilities/ui-utility.js';
import { ConfigUtility } from './utilities/config-utility.js';
import { parseFte, formatFteTag } from './domain/fte.js';
import { yearFraction } from './domain/grid.js';

// Colours for the status badges and milestone pins. They resolve at render
// time against whichever scheme is active, so dark mode can lighten them in
// roadmap-styles.css without the generator knowing about themes.
const STATUS_COLORS = {
    change: 'var(--rm-status-transfer)',
    done: 'var(--rm-status-done)',
    cancel: 'var(--rm-status-cancel)',
    atRisk: 'var(--rm-status-risk)',
    newStory: 'var(--rm-status-new)',
    info: 'var(--rm-status-info)',
    transfer: 'var(--rm-status-transfer)',
    proposed: 'var(--rm-status-proposed)',
    added: 'var(--rm-status-transfer)',
};

export class RoadmapGenerator {
    constructor(roadmapYear = null) {
        this.months = ConfigUtility.getAllMonthNames();
        const year = roadmapYear || new Date().getFullYear();
        const shortYear = year.toString().slice(-2);
        this.quarters = [
            `Q1'${shortYear}`,
            `Q2'${shortYear}`,
            `Q3'${shortYear}`,
            `Q4'${shortYear}`,
        ];
        this.roadmapYear = year;
        this.enableStackedIcons = false;
        // Views without the builder checkboxes (cross-team search) set
        // { epicTitleTop, hideStoryText } here instead.
        this.displayOptions = {};
    }

    // Helper method to check if a story should be displayed based on roadmap year
    shouldDisplayStory(story) {
        if (!this.roadmapYear) return true; // If no roadmap year set, display all

        let startYear = null;
        let endYear = null;

        // Parse start date/year
        if (story.startDate) {
            try {
                let isoStartDate = story.startDate;
                if (story.startDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoStartDate = this.convertEuropeanToISO(story.startDate);
                }
                const startDate = new Date(isoStartDate);
                if (!isNaN(startDate.getTime())) {
                    startYear = startDate.getFullYear();
                }
            } catch {
                // If date parsing fails, continue
            }
        } else if (story.startMonth) {
            // For month-only start dates, assume they're in roadmap year
            startYear = this.roadmapYear;
        }

        // Parse end date/year
        if (story.endDate) {
            try {
                let isoEndDate = story.endDate;
                if (story.endDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoEndDate = this.convertEuropeanToISO(story.endDate);
                }
                const endDate = new Date(isoEndDate);
                if (!isNaN(endDate.getTime())) {
                    endYear = endDate.getFullYear();
                }
            } catch {
                // If date parsing fails, continue
            }
        } else if (story.endMonth) {
            // For month-only end dates, assume they're in roadmap year
            endYear = this.roadmapYear;
        }

        // Show story if it's active during the roadmap year
        // (starts before or during roadmap year AND ends during or after roadmap year)
        if (startYear !== null && endYear !== null) {
            return startYear <= this.roadmapYear && endYear >= this.roadmapYear;
        }

        // If only start year is known, show if it starts in or before roadmap year
        if (startYear !== null) {
            return startYear <= this.roadmapYear;
        }

        // If only end year is known, show if it ends in or after roadmap year
        if (endYear !== null) {
            return endYear >= this.roadmapYear;
        }

        return true; // Display by default if no date info
    }

    // Helper to check if a date is outside the roadmap year
    isDateOutsideRoadmapYear(dateStr) {
        if (!dateStr || !this.roadmapYear) return false;

        try {
            let isoDate = dateStr;
            if (dateStr.match(DateUtility.EUROPEAN_DATE_REGEX)) {
                isoDate = this.convertEuropeanToISO(dateStr);
            }
            const date = new Date(isoDate);
            return !isNaN(date.getTime()) && date.getFullYear() !== this.roadmapYear;
        } catch {
            return false; // If parsing fails, don't filter out
        }
    }

    // Helper to check if a story continues past the roadmap year or search range
    storyContinuesNextYear(story) {
        if (!story.endDate) return false;

        // Use date-only comparison to avoid time component issues
        const storyEndDateStr = this.convertStoryDateToISO(story.endDate, this.roadmapYear);
        if (!storyEndDateStr) return false;

        // Extract year from the ISO date string (YYYY-MM-DD)
        const storyEndYear = parseInt(storyEndDateStr.split('-')[0]);

        // For normal roadmaps, check if story ends after the roadmap year
        if (this.roadmapYear && storyEndYear > this.roadmapYear) {
            return true;
        }

        // For date range searches, check if story ends after the search range END date
        if (this.searchRange && this.searchRange.endDate) {
            return storyEndDateStr > this.searchRange.endDate;
        }

        return false;
    }

    // Convert story date to ISO format (same logic as in IMOUtility but local copy for RoadmapGenerator)
    convertStoryDateToISO(dateStr, defaultYear) {
        if (!dateStr) return null;

        const str = dateStr.toLowerCase().trim();
        const currentYear = defaultYear || new Date().getFullYear();

        // Already in ISO format
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return str;
        }

        // Handle DD/MM/YY or DD/MM/YYYY format
        if (str.includes('/') && /\d+\/\d+/.test(str)) {
            const parts = str.split('/');
            if (parts.length >= 2) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]);
                let year = parts.length > 2 ? parseInt(parts[2]) : currentYear;

                // Handle 2-digit years - always assume 2000s for roadmaps
                if (year < 100) {
                    year = 2000 + year;
                }

                if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                    const dayStr = String(day).padStart(2, '0');
                    const monthStr = String(month).padStart(2, '0');
                    return `${year}-${monthStr}-${dayStr}`;
                }
            }
        }

        // Handle month names (Jan, February, etc.)
        const monthMap = {
            jan: '01',
            january: '01',
            feb: '02',
            february: '02',
            mar: '03',
            march: '03',
            apr: '04',
            april: '04',
            may: '05',
            jun: '06',
            june: '06',
            jul: '07',
            july: '07',
            aug: '08',
            august: '08',
            sep: '09',
            sept: '09',
            september: '09',
            oct: '10',
            october: '10',
            nov: '11',
            november: '11',
            dec: '12',
            december: '12',
        };

        // Check for month name patterns
        for (const [monthName, monthNum] of Object.entries(monthMap)) {
            if (str.includes(monthName)) {
                // Extract day if present
                const dayMatch = str.match(/\d+/);
                const day = dayMatch ? parseInt(dayMatch[0]) : 1;

                // Extract year if present - handle 2-digit years correctly
                const yearMatch = str.match(/\b\d{2,4}\b/);
                let year = currentYear;
                if (yearMatch) {
                    year = parseInt(yearMatch[0]);
                    // Handle 2-digit years - always assume 2000s for roadmaps
                    if (year < 100) {
                        year = 2000 + year;
                    }
                }

                if (day >= 1 && day <= 31) {
                    const dayStr = String(day).padStart(2, '0');
                    return `${year}-${monthNum}-${dayStr}`;
                }
            }
        }

        return null;
    }

    // Helper to check if a story starts on or before the search range
    storyStartsBeforeRange(story) {
        if (!this.searchRange || !this.searchRange.startDate) return false;
        if (!story.startDate && !story.startMonth) return false;

        try {
            let storyStartDate = null;

            if (story.startDate) {
                let isoStartDate = story.startDate;
                if (story.startDate.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/)) {
                    isoStartDate = this.convertEuropeanToISO(story.startDate);
                }
                storyStartDate = new Date(isoStartDate);
            } else if (story.startMonth) {
                // For startMonth, we need to determine the correct year
                // If the story has no explicit year, it's from the roadmap year
                const storyStartStr = story.startMonth;
                const yearToUse = this.roadmapYear || new Date().getFullYear();

                // If startMonth has a date format, extract the year
                if (storyStartStr.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/)) {
                    const isoStartDate = this.convertEuropeanToISO(storyStartStr);
                    storyStartDate = new Date(isoStartDate);
                } else {
                    // Pure month name - use roadmap year
                    storyStartDate = this.parseMonthToDate(storyStartStr, yearToUse);
                }
            }

            if (!storyStartDate || isNaN(storyStartDate.getTime())) {
                return false;
            }

            const searchStartParts = this.searchRange.startDate.split('-');
            const searchStartDate = new Date(
                parseInt(searchStartParts[0]),
                parseInt(searchStartParts[1]) - 1,
                parseInt(searchStartParts[2])
            );
            return storyStartDate <= searchStartDate;
        } catch {
            return false;
        }
    }

    // Helper to parse month string to date
    parseMonthToDate(monthStr, year) {
        const monthMap = {
            jan: 0,
            january: 0,
            feb: 1,
            february: 1,
            mar: 2,
            march: 2,
            apr: 3,
            april: 3,
            may: 4,
            jun: 5,
            june: 5,
            jul: 6,
            july: 6,
            aug: 7,
            august: 7,
            sep: 8,
            sept: 8,
            september: 8,
            oct: 9,
            october: 9,
            nov: 10,
            november: 10,
            dec: 11,
            december: 11,
        };

        const month = monthMap[monthStr.toLowerCase()];
        if (month !== undefined) {
            return new Date(year, month, 1);
        }
        return null;
    }

    // Helper to format story title with start information if it starts in previous year
    getStoryTitleWithStartInfo(story) {
        let title = this.formatText(story.title);

        if (story._startsInPreviousYear && story._actualStartYear && story._originalStartDate) {
            try {
                let isoStartDate = story._originalStartDate;
                if (story._originalStartDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoStartDate = this.convertEuropeanToISO(story._originalStartDate);
                }
                const startDate = new Date(isoStartDate);
                const monthNames = [
                    'Jan',
                    'Feb',
                    'Mar',
                    'Apr',
                    'May',
                    'Jun',
                    'Jul',
                    'Aug',
                    'Sep',
                    'Oct',
                    'Nov',
                    'Dec',
                ];
                const actualStartMonth = monthNames[startDate.getMonth()];
                const startInfo = `<span class="story-start-info">Started ${actualStartMonth} ${story._actualStartYear}</span>`;
                title += startInfo;
            } catch {
                // Fallback if date parsing fails
                const startInfo = `<span class="story-start-info">Started ${story._actualStartYear}</span>`;
                title += startInfo;
            }
        }

        return title;
    }

    // Format text to support strikethrough, underline, bold, italics, and other formatting
    formatText(text) {
        if (!text) return '';

        // Convert Unicode character codes (U+XXXX) to actual Unicode characters
        text = text.replace(/U\+([0-9A-Fa-f]{4,6})/g, (match, hex) => {
            return String.fromCodePoint(parseInt(hex, 16));
        });

        // Convert **text** to bold
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Convert ?text? to italic
        text = text.replace(/\?(.*?)\?/g, '<em>$1</em>');

        // Convert ~~text~~ to strikethrough
        text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');

        // Convert __text__ to underline
        text = text.replace(/__(.*?)__/g, '<u>$1</u>');

        return text;
    }

    // Format monthly description with manual line breaks and italic second line
    formatMonthlyDescription(description) {
        if (!description || typeof description !== 'string') return description;

        const formatted = this.formatText(description);

        let lines = [];
        if (formatted.includes('\n')) {
            lines = formatted.split('\n');
        } else if (formatted.includes('|')) {
            lines = formatted.split('|');
        } else if (formatted.includes('  ')) {
            lines = formatted.split('  ');
        } else {
            return formatted;
        }

        lines = lines.map((line) => line.trim()).filter((line) => line.length > 0);

        if (lines.length === 1) {
            return lines[0];
        } else if (lines.length >= 2) {
            return `${lines[0]}<br/>${lines[1]}`;
        }

        return formatted;
    }

    // Wrap text at specified character limit, breaking at whitespace
    wrapTextAtWordBoundary(text, maxLength = 120) {
        if (!text || text.length <= maxLength) {
            return text;
        }

        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            // If adding this word would exceed the limit and we have content, start a new line
            if (currentLine.length + word.length + 1 > maxLength && currentLine.length > 0) {
                lines.push(currentLine.trim());
                currentLine = word;
            } else {
                // Add word to current line
                if (currentLine.length > 0) {
                    currentLine += ' ' + word;
                } else {
                    currentLine = word;
                }
            }
        }

        // Add the last line if it has content
        if (currentLine.trim().length > 0) {
            lines.push(currentLine.trim());
        }

        return lines.join('<br>');
    }

    // Generate team description HTML - handles both string and array formats for backward compatibility
    generateTeamDescription(description) {
        if (!description) return '';

        if (Array.isArray(description)) {
            // Old format: array of lines
            return description
                .map(
                    (line) =>
                        `<div class="team-description-line">${this.wrapTextAtWordBoundary(this.formatText(line))}</div>`
                )
                .join('');
        } else if (typeof description === 'string') {
            // New format: multi-line string
            const lines = description.split('\n').filter((line) => line.trim() !== '');
            return lines
                .map(
                    (line) =>
                        `<div class="team-description-line">${this.wrapTextAtWordBoundary(this.formatText(line))}</div>`
                )
                .join('');
        }

        return '';
    }

    // Format European date - normalize all European formats to DD/MM/YY for consistent display
    formatDateEuropean(dateStr) {
        return DateUtility.formatDateEuropean(dateStr, this.roadmapYear);
    }

    // Convert European date format to ISO format (YYYY-MM-DD)
    convertEuropeanToISO(dateStr) {
        return DateUtility.convertEuropeanToISO(dateStr, this.roadmapYear);
    }

    // Safe date parsing that handles ONLY European and ISO formats - NO US FORMAT EVER
    parseDateSafe(dateStr) {
        return DateUtility.parseDateSafe(dateStr);
    }

    // Convert month name to grid position
    monthToGrid(month) {
        return ConfigUtility.getMonthGridPosition(month);
    }

    // Convert specific date to grid position with sub-month precision
    dateToGrid(dateStr) {
        return DateUtility.dateToGrid(dateStr, (month) => this.monthToGrid(month));
    }

    // Helper function to get month name from number
    getMonthName(monthNum) {
        return DateUtility.getMonthName(monthNum);
    }

    // Smart position calculator - handles both month names and dates
    getGridPosition(value) {
        return DateUtility.getGridPosition(value, (month) => this.monthToGrid(month));
    }

    // Generate the CSS styles - now links to external CSS file
    generateCSS(fixedWidth = false) {
        // Add cache-busting parameter to force CSS reload
        const timestamp = Date.now();
        let css =
            '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">';
        css += `<link rel="stylesheet" href="roadmap-styles.css?v=${timestamp}">`;

        // Add fixed width styles for read-only roadmap view
        if (fixedWidth) {
            css += `
            <style>
                body {
                    overflow-x: auto;
                    min-width: 1200px;
                }
                .roadmap-container {
                    min-width: 1200px;
                    width: 1200px;
                }
                .timeline-header {
                    min-width: 1200px;
                    width: 1200px;
                }
                .swimlanes-container {
                    min-width: 1200px;
                    width: 1200px;
                }
            </style>`;
        }

        return css;
    }

    // Generate timeline header
    generateTimelineHeader() {
        const quartersHTML = this.quarters
            .map(
                (quarter) =>
                    `<div class="quarter-header" style="grid-column: span 3;">${quarter.replace(/([1-4])'/, "$1 '")}</div>`
            )
            .join('');

        const monthsHTML = this.months
            .map((month) => `<div class="month-header">${month}</div>`)
            .join('');

        return `
        <div class="timeline-header sticky-header">
            <div class="quarters-row">${quartersHTML}</div>
            <div class="months-row">${monthsHTML}</div>
        </div>
        <div class="timeline-separator"></div>`;
    }

    // Generate grid cells for timeline
    generateTimelineGrid() {
        return `
        <div class="timeline-grid">
            ${Array(120)
                .fill()
                .map(() => '<div class="grid-cell"></div>')
                .join('')}
        </div>`;
    }

    // Helper function to get the effective end date (considering timeline changes)
    getEffectiveEndDate(story) {
        // If no timeline changes, use original end date
        if (!story.roadmapChanges?.changes || story.roadmapChanges.changes.length === 0) {
            return story.endDate || story.endMonth;
        }

        // Sort timeline changes by change date (most recent first)
        const sortedChanges = [...story.roadmapChanges.changes].sort((a, b) => {
            return DateUtility.compareDates(b.date, a.date); // Reverse order for most recent first
        });

        // Get the newEndDate from the most recent change
        const mostRecentChange = sortedChanges[0];
        if (mostRecentChange && mostRecentChange.newEndDate) {
            // Determine if this is a date or month format
            const newEndDate = mostRecentChange.newEndDate;
            if (
                newEndDate.includes('-') ||
                newEndDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)
            ) {
                // It's a date format
                return newEndDate;
            } else {
                // It's a month format
                return newEndDate.toUpperCase();
            }
        }

        // Fallback to original end date
        return story.endDate || story.endMonth;
    }

    // Helper function to determine if effective end date is a date or month
    isEffectiveEndDateADate(story) {
        const effectiveEndDate = this.getEffectiveEndDate(story);
        if (!effectiveEndDate) return false;

        // Check if it's a date format (contains - or matches DD/MM pattern)
        return (
            effectiveEndDate.includes('-') ||
            effectiveEndDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)
        );
    }

    // Generate story HTML
    generateStory(
        story,
        epicName = '',
        storyIndex = 0,
        embedded = false,
        _backgroundColor = '',
        epicId = ''
    ) {
        // Check if story should be displayed based on roadmap year
        if (!this.shouldDisplayStory(story)) {
            return ''; // Don't display stories with dates outside roadmap year
        }

        // Generate unique identifier for story-textbox pairing (sanitize for CSS selectors)
        const storyId = UIUtility.generateStoryId(epicName, storyIndex);

        // Support both date formats (startDate/endDate and startMonth/endMonth)
        const startValue = story.startDate || story.startMonth;

        // Use effective end date that considers timeline changes
        const effectiveEndValue = this.getEffectiveEndDate(story);
        const effectiveEndIsDate = this.isEffectiveEndDateADate(story);

        let startGrid;
        // Use clean 4-position system for start dates (same as end dates)
        if (story.startDate) {
            try {
                // Convert European date to ISO if needed
                let isoStartDate = story.startDate;
                if (story.startDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoStartDate = this.convertEuropeanToISO(story.startDate);
                }

                const startDate = new Date(isoStartDate);
                if (!isNaN(startDate.getTime())) {
                    // Check if story starts before the roadmap year
                    if (startDate.getFullYear() < this.roadmapYear) {
                        // Story starts before roadmap year - treat exactly as if it starts on 01/01/2025
                        // Override the story's start date to be 01/01 of roadmap year for positioning
                        story._originalStartDate = story.startDate; // Save original for reference
                        story.startDate = `01/01/${this.roadmapYear}`; // Set to January 1st of roadmap year
                        const jan1IsoDate = `${this.roadmapYear}-01-01`;

                        // Use the same logic as normal January 1st dates
                        const isStartOfMonth = DateUtility.isStartOfMonth(jan1IsoDate);
                        if (isStartOfMonth) {
                            startGrid = this.monthToGrid('JAN');
                        } else {
                            startGrid = DateUtility.dateToGrid(
                                jan1IsoDate,
                                this.monthToGrid.bind(this)
                            );
                        }
                        // Note: January 1st is never the 15th, so no special backup needed here

                        // Add visual indicator that story started in previous year
                        story._startsInPreviousYear = true;
                        story._actualStartYear = startDate.getFullYear();
                    } else {
                        // Story starts in roadmap year - use 4-position system
                        const isStartOfMonth = DateUtility.isStartOfMonth(isoStartDate);
                        const isEndOfPreviousMonth = DateUtility.isEndOfPreviousMonth(isoStartDate);

                        if (isStartOfMonth) {
                            // Start of month (1st-3rd): Position at month start
                            const monthName = this.getMonthName(startDate.getMonth() + 1);
                            startGrid = this.monthToGrid(monthName);
                        } else if (isEndOfPreviousMonth) {
                            // End of previous month (1st-3rd): Position at previous month start
                            const previousMonthName =
                                DateUtility.getPreviousMonthName(isoStartDate);
                            startGrid = this.monthToGrid(previousMonthName);
                        } else {
                            // Regular dates (4th-31st)
                            const startDateObj = new Date(isoStartDate);
                            const dayOfMonth = startDateObj.getDate();

                            if (dayOfMonth >= 28) {
                                // 27th–31st: position as 1st of next month
                                const currentMonth = startDateObj.getMonth() + 1; // getMonth() is 0-based
                                const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
                                const nextMonthName = this.getMonthName(nextMonth);
                                startGrid = this.monthToGrid(nextMonthName);
                            } else {
                                // Base: 4-position system
                                startGrid = DateUtility.dateToGrid(
                                    isoStartDate,
                                    this.monthToGrid.bind(this)
                                );

                                // Adjust: 4th–27th shift back by 2 grid units
                                if (dayOfMonth >= 4 && dayOfMonth <= 27) {
                                    startGrid = startGrid - 2;
                                }
                            }
                        }
                    }
                } else {
                    startGrid = this.getGridPosition(startValue);
                }
            } catch {
                // If date parsing fails, use fallback
                startGrid = this.getGridPosition(startValue);
            }
        } else {
            // Month name path - use monthToGrid directly for consistency
            startGrid = this.monthToGrid(startValue);
        }

        let endGrid;
        if (effectiveEndValue) {
            // Check if this is a date that represents end of month (26th-31st) or end of previous month (1st-3rd)
            const isEndOfMonth = effectiveEndIsDate && DateUtility.isEndOfMonth(effectiveEndValue);
            const isEndOfPreviousMonth =
                effectiveEndIsDate && DateUtility.isEndOfPreviousMonth(effectiveEndValue);

            if (!effectiveEndIsDate) {
                // Month name: position at month start + 10 to span full month
                endGrid = this.getGridPosition(effectiveEndValue) + 10;
            } else if (isEndOfMonth) {
                // End of month (26th-31st): treat like month name - position at month start + 10
                const parsedEndDate = this.parseDateSafe(effectiveEndValue);
                const monthName = this.getMonthName(parsedEndDate.getMonth() + 1);
                endGrid = this.getGridPosition(monthName) + 10;
            } else if (isEndOfPreviousMonth) {
                // End of previous month (1st-3rd): treat as end of previous month
                const previousMonthName = DateUtility.getPreviousMonthName(effectiveEndValue);
                endGrid = this.getGridPosition(previousMonthName) + 10;
            } else {
                // Regular specific date: handle with alignment adjustments
                try {
                    // Convert European date to ISO if needed
                    let isoEndDate = effectiveEndValue;
                    if (effectiveEndValue.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                        isoEndDate = this.convertEuropeanToISO(effectiveEndValue);
                    }

                    const endDate = new Date(isoEndDate);
                    if (!isNaN(endDate.getTime())) {
                        const dayOfMonth = endDate.getDate();

                        if (DateUtility.isStartOfMonth(isoEndDate)) {
                            // Start of month (1st-3rd): Use new 4-position system
                            endGrid = this.getGridPosition(isoEndDate);
                        } else if (dayOfMonth >= 4 && dayOfMonth <= 25) {
                            // Mid-month dates (4th-25th): Use new 4-position system
                            endGrid = this.getGridPosition(isoEndDate);
                        } else {
                            // 26th-31st should be handled by isEndOfMonth above, but fallback to exact positioning
                            endGrid = this.getGridPosition(isoEndDate);
                        }
                    } else {
                        endGrid = this.getGridPosition(effectiveEndValue);
                    }
                } catch {
                    // If date parsing fails, use original
                    endGrid = this.getGridPosition(effectiveEndValue);
                }
            }
        } else {
            endGrid = startGrid + 10; // Default to one month width
        }

        // Check if story continues past roadmap year or search range - if so, extend to December
        const continuesNextYear = this.storyContinuesNextYear(story);
        const startsBeforeRange = this.storyStartsBeforeRange(story);
        const isContinuingStory = continuesNextYear || startsBeforeRange;

        if (continuesNextYear) {
            endGrid = this.getGridPosition('DEC') + 10; // Extend to end of December
        }

        // For stories that start before search range, ensure they start from January
        if (startsBeforeRange) {
            startGrid = this.getGridPosition('JAN'); // Start from January
        }

        const bulletsHTML = UIUtility.generateBulletsHTML(story.bullets, (text) =>
            this.formatText(text)
        );

        // One compact badge keeps multiple timeline changes legible at roadmap scale.
        let iconHTML = '';
        if (
            story.hasRoadmapChanges &&
            story.roadmapChanges.changes &&
            story.roadmapChanges.changes.length > 0
        ) {
            const numChanges = story.roadmapChanges.changes.length;
            const count = numChanges > 1 ? ` ${numChanges}` : '';
            iconHTML = `<div class="roadmap-icon" title="${numChanges} timeline ${numChanges === 1 ? 'change' : 'changes'}">↻${count}</div>`;
        }

        // Below-the-line placement already communicates the story's role.
        if (epicName === 'Below the Line') {
            iconHTML = '';
        }
        // Icon precedence system - only highest priority icon shows in each position

        // Top-left position: Proposed > New Story
        const showProposedIcon = story.isProposed;
        const showNewStoryIcon = story.isNewStory && !story.isProposed;

        // Bottom-right position: Cancelled > Done > At Risk > Transferred Out
        const showCancelledIcon = story.isCancelled;
        const showDoneIcon = story.isDone && !story.isCancelled;
        const showAtRiskIcon = story.isAtRisk && !story.isCancelled && !story.isDone;
        const showTransferredOutIcon =
            story.isTransferredOut && !story.isCancelled && !story.isDone && !story.isAtRisk;

        // Bottom-left position: Info > Transferred In
        const showInfoIcon = story.isInfo;
        const showTransferredInIcon = story.isTransferredIn && !story.isInfo;

        const doneIconHTML = showDoneIcon ? '<div class="done-icon" title="Done">✓</div>' : '';
        const cancelIconHTML = showCancelledIcon
            ? '<div class="cancel-icon" title="Cancelled">✕</div>'
            : '';
        const atRiskIconHTML = showAtRiskIcon
            ? '<div class="atrisk-icon" title="At risk"></div>'
            : '';
        const newStoryIconHTML = showNewStoryIcon
            ? '<div class="newstory-icon" title="New story">★</div>'
            : '';
        const transferredOutIconHTML = showTransferredOutIcon
            ? '<div class="transferredout-icon" title="Transferred out">→</div>'
            : '';
        const infoIconHTML = showInfoIcon
            ? '<div class="transferredin-icon info-position" title="Information">i</div>'
            : '';
        const transferredInIconHTML = showTransferredInIcon
            ? '<div class="transferredin-icon" title="Transferred in">←</div>'
            : '';
        const proposedIconHTML = showProposedIcon
            ? '<div class="proposed-icon" title="Proposed">?</div>'
            : '';

        // Generate country flags HTML (local SVGs, avoids Windows flag-emoji gaps)
        let countryFlagsHTML = '';
        if (story.countryFlags && story.countryFlags.length > 0) {
            const flagMap = {
                Global: 'global',
                UK: 'gb',
                Iceland: 'is',
                Hungary: 'hu',
                Spain: 'es',
                Italy: 'it',
                Portugal: 'pt',
                Czechia: 'cz',
                Slovakia: 'sk',
                Slovenia: 'si',
                Croatia: 'hr',
                Germany: 'de',
                France: 'fr',
            };
            const flagImgs = story.countryFlags
                .map((f) => flagMap[f])
                .filter(Boolean)
                .map(
                    (code) =>
                        `<img src="./assets/flags/${code}.svg" class="flag-icon" alt="${code}">`
                )
                .join('');
            const hasTimelineIcon = iconHTML !== '';
            const topOffset = hasTimelineIcon ? '3px' : '3px';
            const rightOffset = hasTimelineIcon ? '11px' : '4px';
            countryFlagsHTML = `<div class="country-flags-display" style="position: absolute; top: ${topOffset}; right: ${rightOffset}; z-index: 9998; line-height: 1;">${flagImgs}</div>`;
        }

        const cancelledClass = story.isCancelled ? ' story-cancelled' : '';
        const transferredClass =
            story.isTransferredIn || story.isTransferredOut ? ' story-transferred' : '';
        const proposedClass = story.isProposed ? ' story-proposed' : '';
        const continuesClass = isContinuingStory ? ' story-continues story-with-continuation' : '';
        const storyWidth = endGrid - startGrid;

        // Graduated zooming logic: all stories can zoom, just at different levels based on width
        // Pass startGrid and endGrid to apply special rules (e.g., January/December stories > 3 months cap at 1.10x)
        const zoomLevel = ConfigUtility.getZoomLevel(storyWidth, startGrid, endGrid);
        const zoomClass = ` story-zoom-${zoomLevel}`;

        // Add edit icon only in embedded mode (builder view)
        const editIconHTML = UIUtility.generateEditIconHTML(
            embedded,
            epicName,
            story.title,
            storyIndex,
            (text) => this.formatText(text)
        );

        // The side status text box is always rendered by generateEpic. The
        // beta toggle adds the milestone track below the bar; each pin carries
        // its own popover that appears next to that specific icon on hover.
        const showHoverExtras = !this.isStatusStyleSide();
        const milestonesTrackHTML = showHoverExtras
            ? this.generateStoryMilestonesTrack(story, startGrid, endGrid)
            : '';

        // Add continuation year indicator for stories that continue past roadmap year or start before search range
        let continuationYearHTML = '';
        if (continuesNextYear && story.endDate) {
            // Story continues after the search range - show actual end date using date-only logic
            const storyEndDateStr = this.convertStoryDateToISO(story.endDate, this.roadmapYear);
            if (storyEndDateStr) {
                const [yearStr, monthStr] = storyEndDateStr.split('-');
                const actualEndYear = parseInt(yearStr);
                const monthIndex = parseInt(monthStr) - 1; // Convert to 0-based index
                const monthNames = [
                    'Jan',
                    'Feb',
                    'Mar',
                    'Apr',
                    'May',
                    'Jun',
                    'Jul',
                    'Aug',
                    'Sep',
                    'Oct',
                    'Nov',
                    'Dec',
                ];
                const actualEndMonth = monthNames[monthIndex];
                continuationYearHTML = `<div class="continuation-indicator">continues → ${actualEndMonth} '${String(actualEndYear).slice(-2)}</div>`;
            } else {
                // Fallback to roadmap year + 1 if date parsing fails
                const nextYear = this.roadmapYear + 1;
                continuationYearHTML = `<div class="continuation-indicator">continues → Dec '${String(nextYear).slice(-2)}</div>`;
            }
        }

        // Determine visual month alignment from computed startGrid so dates shifted
        // to next month (e.g., 28th–31st) get identical alignment as true month starts
        let startsInJanuary = false;
        let startsInOctober = false;
        // Only apply alignment tweaks when exactly at the start of a month grid
        for (const monthName of this.months) {
            if (startGrid === this.monthToGrid(monthName)) {
                if (monthName === 'JAN') startsInJanuary = true;
                if (monthName === 'OCT') startsInOctober = true;
                break;
            }
        }

        let positionClass = '';
        if (startsInJanuary) {
            positionClass = ' story-positioned-january';
        } else if (startsInOctober) {
            positionClass = ' story-positioned-october';
        }

        // Tags above the bar: FTE, then priority, then IMO. Any one of them on
        // its own is enough to draw the row.
        const fte = parseFte(story.fte);
        const fteTagHTML = fte === null ? '' : `<div class="fte-tag">${formatFteTag(fte)}</div>`;
        const priorityTagHTML = story.priority
            ? `<div class="priority-tag priority-${story.priority.toLowerCase()}">${story.priority}</div>`
            : '';
        const imoTagHTML = story.imo ? `<div class="imo-tag">${story.imo}</div>` : '';
        const storyTagsHTML =
            fteTagHTML || priorityTagHTML || imoTagHTML
                ? `<div class="story-tags">${fteTagHTML}${priorityTagHTML}${imoTagHTML}</div>`
                : '';

        // Badges pinned to the bar's bottom corners.
        const bottomIconsHTML = `${doneIconHTML}${cancelIconHTML}${atRiskIconHTML}${transferredOutIconHTML}${infoIconHTML}${transferredInIconHTML}`;

        // With story text hidden the bullets move into an overlay that opens
        // below the title on hover, so the bar grows without pushing the rows
        // underneath. The bottom badges and milestone track ride along so they
        // stay at the bottom edge, wherever it is.
        const hideText = !!bulletsHTML && this.isStoryTextHidden();
        const storyBodyHTML = hideText
            ? `<div class="story-details"><div class="story-details-body">${bulletsHTML}</div>${bottomIconsHTML}${milestonesTrackHTML}</div>`
            : `${bulletsHTML}${milestonesTrackHTML}`;

        return `
            <div class="story-item${cancelledClass}${transferredClass}${proposedClass}${continuesClass}${zoomClass}${positionClass}"
             style="--start: ${startGrid}; --end: ${endGrid};"
             data-epic-name="${(epicName || '').replace(/"/g, '&quot;')}"
             data-epic-id="${(epicId || '').replace(/"/g, '&quot;')}"
             data-story-title="${(story.title || '').replace(/"/g, '&quot;')}"
             data-story-index="${storyIndex}"
             data-story-id="${storyId}"
             data-json-story-id="${this.formatText(story.storyId || '')}">
            ${iconHTML}
            ${countryFlagsHTML}
            ${hideText ? '' : bottomIconsHTML}
            ${newStoryIconHTML}
            ${proposedIconHTML}
            ${editIconHTML}
            ${continuationYearHTML}
            ${storyTagsHTML}
                                <div class="task-title">${this.getStoryTitleWithStartInfo(story)}</div>
            ${storyBodyHTML}
        </div>`;
    }

    // Helper function to truncate EPIC names based on available height
    truncateEpicName(name, numStories = 1) {
        // A top title has the full swimlane width, so it is never cut short.
        if (this.isEpicTitleTop()) return UIUtility.cleanWhitespace(name);
        return UIUtility.processEpicName(name, numStories);
    }

    // Helper function to parse date strings and compare them
    isEarlyDelivery(prevEndDate, newEndDate) {
        return DateUtility.isEarlyDelivery(prevEndDate, newEndDate);
    }

    // Compute precise grid position for a milestone date (per-day, not 4-position).
    // Returns null if date can't be parsed.
    milestoneDateToGrid(dateStr) {
        if (!dateStr) return null;
        try {
            let isoDate = dateStr;
            if (dateStr.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                isoDate = this.convertEuropeanToISO(dateStr);
            }
            const date = this.parseDateSafe(isoDate);
            if (!date || isNaN(date.getTime())) return null;
            const monthName = this.getMonthName(date.getMonth() + 1);
            const monthStartCol = this.monthToGrid(monthName);
            const day = date.getDate();
            // Each month spans 10 grid units. Map day 1->0, day 31->10.
            const offset = ((day - 1) / 30) * 10;
            return monthStartCol + offset;
        } catch {
            return null;
        }
    }

    // Collect all milestone events from a story's roadmapChanges into a flat array
    // sorted chronologically. Each event has: { type, date, glyph, color, label, subtitle?, notes? }.
    collectStoryMilestones(story) {
        if (!story.roadmapChanges) return [];

        const rc = story.roadmapChanges;
        const events = [];

        if (rc.changes && rc.changes.length > 0) {
            rc.changes.forEach((change) => {
                const startMoved =
                    change.prevStartDate &&
                    change.newStartDate &&
                    change.prevStartDate !== change.newStartDate;
                const endMoved =
                    change.prevEndDate &&
                    change.newEndDate &&
                    change.prevEndDate !== change.newEndDate;

                const movement = (prev, next) => {
                    const early = this.isEarlyDelivery(prev, next);
                    const arrow = early ? '&lt;-' : '-&gt;';
                    return `${this.formatDateEuropean(prev)} ${arrow} ${this.formatDateEuropean(next)}`;
                };

                const subtitleParts = [];
                if (startMoved)
                    subtitleParts.push(
                        `Start ${movement(change.prevStartDate, change.newStartDate)}`
                    );
                if (endMoved)
                    subtitleParts.push(
                        `${startMoved ? 'End ' : ''}${movement(change.prevEndDate, change.newEndDate)}`
                    );
                // Fall back to the end date so an entry always shows something.
                if (subtitleParts.length === 0) {
                    subtitleParts.push(movement(change.prevEndDate, change.newEndDate));
                }

                events.push({
                    type: 'change',
                    date: change.date,
                    glyph: '↻',
                    color: STATUS_COLORS.change,
                    label: this.formatDateEuropean(change.date),
                    subtitle: subtitleParts.join(' &middot; '),
                    notes: change.description,
                });
            });
        }

        if (rc.doneInfo && (rc.doneInfo.date || rc.doneInfo.notes)) {
            events.push({
                type: 'done',
                date: rc.doneInfo.date,
                glyph: '✓',
                color: STATUS_COLORS.done,
                label: this.formatDateEuropean(rc.doneInfo.date),
                notes: rc.doneInfo.notes,
            });
        }

        if (rc.cancelInfo && (rc.cancelInfo.date || rc.cancelInfo.notes)) {
            events.push({
                type: 'cancel',
                date: rc.cancelInfo.date,
                glyph: '✕',
                color: STATUS_COLORS.cancel,
                label: this.formatDateEuropean(rc.cancelInfo.date),
                notes: rc.cancelInfo.notes,
            });
        }

        if (rc.atRiskInfo && (rc.atRiskInfo.date || rc.atRiskInfo.notes)) {
            events.push({
                type: 'atrisk',
                date: rc.atRiskInfo.date,
                glyph: '!',
                color: STATUS_COLORS.atRisk,
                label: this.formatDateEuropean(rc.atRiskInfo.date),
                notes: rc.atRiskInfo.notes,
            });
        }

        if (rc.newStoryInfo && (rc.newStoryInfo.date || rc.newStoryInfo.notes)) {
            events.push({
                type: 'newstory',
                date: rc.newStoryInfo.date,
                glyph: '★',
                color: STATUS_COLORS.newStory,
                label: this.formatDateEuropean(rc.newStoryInfo.date),
                notes: rc.newStoryInfo.notes,
            });
        }

        if (rc.infoInfo) {
            const arr = Array.isArray(rc.infoInfo) ? rc.infoInfo : [rc.infoInfo];
            arr.forEach((entry) => {
                if (entry && (entry.date || entry.notes)) {
                    events.push({
                        type: 'info',
                        date: entry.date,
                        glyph: 'i',
                        color: STATUS_COLORS.info,
                        label: this.formatDateEuropean(entry.date),
                        notes: entry.notes,
                    });
                }
            });
        }

        if (rc.transferredInInfo && (rc.transferredInInfo.date || rc.transferredInInfo.notes)) {
            events.push({
                type: 'transferred-in',
                date: rc.transferredInInfo.date,
                glyph: '←',
                color: STATUS_COLORS.transfer,
                label: `In: ${this.formatDateEuropean(rc.transferredInInfo.date)}`,
                notes: rc.transferredInInfo.notes,
            });
        }

        if (rc.transferredOutInfo && (rc.transferredOutInfo.date || rc.transferredOutInfo.notes)) {
            events.push({
                type: 'transferred-out',
                date: rc.transferredOutInfo.date,
                glyph: '→',
                color: STATUS_COLORS.transfer,
                label: `Out: ${this.formatDateEuropean(rc.transferredOutInfo.date)}`,
                notes: rc.transferredOutInfo.notes,
            });
        }

        if (rc.proposedInfo && (rc.proposedInfo.date || rc.proposedInfo.notes)) {
            events.push({
                type: 'proposed',
                date: rc.proposedInfo.date,
                glyph: '?',
                color: STATUS_COLORS.proposed,
                label: this.formatDateEuropean(rc.proposedInfo.date),
                notes: rc.proposedInfo.notes,
            });
        }

        events.sort((a, b) => DateUtility.compareDates(a.date, b.date));
        return events;
    }

    // True when the user has chosen the legacy "side" status placement (status
    // events rendered as a text box to the right of the story) instead of the
    // hover-revealed track + popover. Reads from the documentElement attribute
    // first (synced live by the nav toggle) then falls back to localStorage.
    isStatusStyleSide() {
        if (typeof document !== 'undefined') {
            const attr = document.documentElement.getAttribute('data-status-style');
            if (attr === 'side') return true;
            if (attr === 'hover') return false;
        }
        try {
            return ConfigUtility.getStatusStyle() === 'side';
        } catch {
            return false;
        }
    }

    // True when the user has enabled "Force all text boxes below stories" via the
    // builder toggle, the search toggle, or persisted localStorage. Drives the
    // milestone popover's vertical placement (below the bar instead of above).
    isForceTextBelow() {
        if (typeof document !== 'undefined') {
            const builderToggle = document.getElementById('force-text-below-toggle');
            if (builderToggle && builderToggle.checked) return true;
            const searchToggle = document.getElementById('search-force-text-below-toggle');
            if (searchToggle && searchToggle.checked) return true;
        }
        try {
            return ConfigUtility.shouldForceTextBelow();
        } catch {
            return false;
        }
    }

    // Builder display toggles under "Force all text boxes below stories". Other
    // views keep the default layout unless they pass displayOptions.
    isToggleChecked(id) {
        if (typeof document === 'undefined') return false;
        const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
        return !!(toggle && toggle.checked);
    }

    // Epic names sit in a row at the top of each swimlane instead of rotated
    // down the left edge.
    isEpicTitleTop() {
        return this.displayOptions.epicTitleTop ?? this.isToggleChecked('epic-title-top-toggle');
    }

    // Story bars show only their title; the bullets appear on hover.
    isStoryTextHidden() {
        return this.displayOptions.hideStoryText ?? this.isToggleChecked('hide-story-text-toggle');
    }

    // Vertical marker for today's date, placed proportionally within its
    // month. Only drawn when today falls inside the roadmap year.
    generateTodayLine(today = new Date()) {
        const fraction = yearFraction(today, this.roadmapYear);
        if (fraction === null) return '';
        const label = `Today · ${today.getDate()} ${this.months[today.getMonth()]}`;
        return `<div class="today-line" style="left: ${(fraction * 100).toFixed(3)}%;" title="${label}" aria-hidden="true"></div>`;
    }

    // Generate a hover-revealed horizontal track placed below the story bar in the
    // story-track grid. The track spans the union of story bounds and event dates,
    // with each event rendered as a pin at its actual calendar position. The story's
    // own start/end positions are marked with ticks for context. Each pin carries
    // its own popover with that event's date/subtitle/notes, shown on pin hover.
    generateStoryMilestonesTrack(story, storyStartGrid, storyEndGrid) {
        const events = this.collectStoryMilestones(story);
        if (events.length === 0) return '';

        const positioned = events.map((ev) => ({ ev, grid: this.milestoneDateToGrid(ev.date) }));
        const validGrids = positioned.map((p) => p.grid).filter((g) => g !== null);

        let trackStart = storyStartGrid;
        let trackEnd = storyEndGrid;
        if (validGrids.length > 0) {
            trackStart = Math.min(trackStart, ...validGrids);
            trackEnd = Math.max(trackEnd, ...validGrids);
        }
        trackStart = Math.max(1, Math.floor(trackStart));
        trackEnd = Math.min(121, Math.ceil(trackEnd));
        if (trackEnd <= trackStart) trackEnd = trackStart + 1;

        const trackWidth = trackEnd - trackStart;
        const pctOf = (grid) =>
            Math.max(0, Math.min(100, ((grid - trackStart) / trackWidth) * 100));
        const storyStartPct = pctOf(storyStartGrid);
        const storyEndPct = pctOf(storyEndGrid);

        // Pins emit at row 0 by default; the post-render layout pass
        // (RoadmapGenerator.layoutMilestoneLabels) measures each label's
        // horizontal extent and bumps overlappers to higher rows so close
        // chronological events don't visually collide.
        const pinsHTML = positioned
            .map(({ ev, grid }, idx) => {
                const percent = grid === null ? storyStartPct : pctOf(grid);
                const subtitle = ev.subtitle
                    ? `<div class="milestone-popover-subtitle">${ev.subtitle}</div>`
                    : '';
                const notes = ev.notes
                    ? `<div class="milestone-popover-notes">${this.formatText(ev.notes)}</div>`
                    : '';
                return `<span class="milestone-pin-slot milestone-${ev.type}" style="left: ${percent}%; --milestone-color: ${ev.color};" data-milestone-index="${idx}">
                        <span class="milestone-pin"><span class="milestone-pin-glyph">${ev.glyph}</span></span>
                        <div class="milestone-pin-popover">
                            <div class="milestone-popover-date">${ev.label || ''}</div>
                            ${subtitle}
                            ${notes}
                        </div>
                    </span>`;
            })
            .join('');

        return `<div class="story-milestones-track" style="--track-start: ${trackStart}; --track-end: ${trackEnd};">
                    <span class="milestones-line"></span>
                    <span class="milestones-tick milestones-tick-start" style="left: ${storyStartPct}%;"></span>
                    <span class="milestones-tick milestones-tick-end" style="left: ${storyEndPct}%;"></span>
                    ${pinsHTML}
                </div>`;
    }

    // Legacy "side" placement: compute the same story start/end positioning the
    // hover layout uses, then place a roadmap-text box to the right of the bar
    // (or below it when there isn't room) and call generateRoadmapChanges. This
    // mirrors the rendering used before the hover bar refactor (commit e408af0).
    generateSideStatusTextBox(story, epicName, storyIndex, backgroundColor) {
        const rc = story.roadmapChanges;
        const hasChanges = rc && rc.changes && rc.changes.length > 0;
        const hasDoneInfo = rc && rc.doneInfo && (rc.doneInfo.date || rc.doneInfo.notes);
        const hasCancelInfo = rc && rc.cancelInfo && (rc.cancelInfo.date || rc.cancelInfo.notes);
        const hasAtRiskInfo = rc && rc.atRiskInfo && (rc.atRiskInfo.date || rc.atRiskInfo.notes);
        const hasNewStoryInfo =
            rc && rc.newStoryInfo && (rc.newStoryInfo.date || rc.newStoryInfo.notes);
        const hasInfoInfo =
            rc &&
            rc.infoInfo &&
            ((Array.isArray(rc.infoInfo) && rc.infoInfo.length > 0) ||
                (!Array.isArray(rc.infoInfo) && (rc.infoInfo.date || rc.infoInfo.notes)));
        const hasTransferredOutInfo =
            rc &&
            rc.transferredOutInfo &&
            (rc.transferredOutInfo.date || rc.transferredOutInfo.notes);
        const hasTransferredInInfo =
            rc && rc.transferredInInfo && (rc.transferredInInfo.date || rc.transferredInInfo.notes);
        const hasProposedInfo =
            rc && rc.proposedInfo && (rc.proposedInfo.date || rc.proposedInfo.notes);
        if (
            !hasChanges &&
            !hasDoneInfo &&
            !hasCancelInfo &&
            !hasAtRiskInfo &&
            !hasNewStoryInfo &&
            !hasInfoInfo &&
            !hasTransferredOutInfo &&
            !hasTransferredInInfo &&
            !hasProposedInfo
        ) {
            return '';
        }
        if (!this.shouldDisplayStory(story)) return '';

        const storyId = UIUtility.generateStoryId(epicName, storyIndex);

        let totalItems = 0;
        if (hasChanges) totalItems += rc.changes.length;
        if (hasDoneInfo) totalItems += 1;
        if (hasCancelInfo) totalItems += 1;
        if (hasAtRiskInfo) totalItems += 1;
        if (hasNewStoryInfo) totalItems += 1;
        if (hasInfoInfo) totalItems += Array.isArray(rc.infoInfo) ? rc.infoInfo.length : 1;
        if (hasTransferredOutInfo) totalItems += 1;
        if (hasTransferredInInfo) totalItems += 1;
        if (hasProposedInfo) totalItems += 1;
        const textBoxWidth = ConfigUtility.calculateTextBoxWidth(totalItems);

        let storyStartGrid;
        if (story.startDate) {
            try {
                let isoStartDate = story.startDate;
                if (story.startDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoStartDate = this.convertEuropeanToISO(story.startDate);
                }
                const startDate = this.parseDateSafe(isoStartDate);
                if (startDate && !isNaN(startDate.getTime())) {
                    if (startDate.getFullYear() < this.roadmapYear) {
                        story._originalStartDate = story.startDate;
                        story.startDate = `01/01/${this.roadmapYear}`;
                        const jan1IsoDate = `${this.roadmapYear}-01-01`;
                        const isStartOfMonth = DateUtility.isStartOfMonth(jan1IsoDate);
                        storyStartGrid = isStartOfMonth
                            ? this.monthToGrid('JAN')
                            : DateUtility.dateToGrid(jan1IsoDate, this.monthToGrid.bind(this));
                        story._startsInPreviousYear = true;
                        story._actualStartYear = startDate.getFullYear();
                    } else {
                        const isStartOfMonth = DateUtility.isStartOfMonth(isoStartDate);
                        const isEndOfPreviousMonth = DateUtility.isEndOfPreviousMonth(isoStartDate);
                        if (isStartOfMonth) {
                            const monthName = this.getMonthName(startDate.getMonth() + 1);
                            storyStartGrid = this.monthToGrid(monthName);
                        } else if (isEndOfPreviousMonth) {
                            const previousMonthName =
                                DateUtility.getPreviousMonthName(isoStartDate);
                            storyStartGrid = this.monthToGrid(previousMonthName);
                        } else {
                            storyStartGrid = DateUtility.dateToGrid(
                                isoStartDate,
                                this.monthToGrid.bind(this)
                            );
                            const dayOfMonth = startDate.getDate();
                            if (dayOfMonth >= 11 && dayOfMonth <= 21) {
                                storyStartGrid -= 2;
                            } else if (dayOfMonth >= 22 && dayOfMonth <= 26) {
                                storyStartGrid -= 5;
                            } else if (dayOfMonth >= 27 && dayOfMonth <= 31) {
                                const currentMonth = startDate.getMonth() + 1;
                                const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
                                storyStartGrid = this.monthToGrid(this.getMonthName(nextMonth));
                            } else if (dayOfMonth >= 4 && dayOfMonth <= 10) {
                                storyStartGrid -= 1;
                            }
                        }
                    }
                } else {
                    storyStartGrid = this.getGridPosition(story.startDate);
                }
            } catch {
                storyStartGrid = this.getGridPosition(story.startDate);
            }
        } else {
            storyStartGrid = this.monthToGrid(story.startMonth);
        }

        let storyEndGrid;
        let actualEndGrid;
        const effectiveEndValue = this.getEffectiveEndDate(story);
        const effectiveEndIsDate = this.isEffectiveEndDateADate(story);
        if (effectiveEndIsDate) {
            const parsedEndDate = this.parseDateSafe(effectiveEndValue);
            const isEndOfMonth = DateUtility.isEndOfMonth(effectiveEndValue);
            const isEndOfPreviousMonth = DateUtility.isEndOfPreviousMonth(effectiveEndValue);
            if (isEndOfMonth) {
                const monthName = this.getMonthName(parsedEndDate.getMonth() + 1);
                storyEndGrid = this.getGridPosition(monthName) + 10;
                actualEndGrid = storyEndGrid;
            } else if (isEndOfPreviousMonth) {
                const previousMonthName = DateUtility.getPreviousMonthName(effectiveEndValue);
                storyEndGrid = this.getGridPosition(previousMonthName) + 10;
                actualEndGrid = storyEndGrid;
            } else if (parsedEndDate && DateUtility.isValidDate(parsedEndDate)) {
                storyEndGrid = DateUtility.dateToGrid(
                    effectiveEndValue,
                    this.monthToGrid.bind(this)
                );
                actualEndGrid = this.getGridPosition(effectiveEndValue);
            } else {
                storyEndGrid = this.getGridPosition(effectiveEndValue);
                actualEndGrid = storyEndGrid;
            }
        } else {
            storyEndGrid = this.getGridPosition(effectiveEndValue) + 10;
            actualEndGrid = storyEndGrid;
        }

        let endsBetweenOct4AndDec31 = false;
        if (effectiveEndIsDate) {
            const parsed = this.parseDateSafe(effectiveEndValue);
            if (parsed && !isNaN(parsed.getTime()) && parsed.getFullYear() === this.roadmapYear) {
                const m = parsed.getMonth();
                const d = parsed.getDate();
                if (m > 9 || (m === 9 && d >= 4)) endsBetweenOct4AndDec31 = true;
            }
        }
        const continuesNextYear = this.storyContinuesNextYear(story);
        const visualStoryEndGrid = continuesNextYear
            ? this.getGridPosition('DEC') + 10
            : storyEndGrid;

        let shouldPositionBelowFinal = false;
        if (continuesNextYear || endsBetweenOct4AndDec31) {
            shouldPositionBelowFinal = true;
        } else {
            const buffer = 2;
            const combinedWidth = visualStoryEndGrid + buffer + textBoxWidth;
            if (ConfigUtility.exceedsMaxGrid(combinedWidth)) {
                shouldPositionBelowFinal = true;
            }
        }
        const forceBelowGlobal = this.isForceTextBelow();
        if (forceBelowGlobal) shouldPositionBelowFinal = true;

        let changeStartGrid;
        let changeEndGrid;
        if (shouldPositionBelowFinal) {
            changeStartGrid = forceBelowGlobal ? storyStartGrid : storyStartGrid + 1;
            changeEndGrid = changeStartGrid + textBoxWidth;
            if (ConfigUtility.exceedsMaxGrid(changeEndGrid)) {
                const overflow = changeEndGrid - ConfigUtility.getMaxGrid();
                changeStartGrid = Math.max(1, changeStartGrid - overflow);
                changeEndGrid = changeStartGrid + textBoxWidth;
            }
        } else {
            const buffer = 2;
            changeStartGrid = actualEndGrid + buffer;
            changeEndGrid = changeStartGrid + textBoxWidth;
        }

        return this.generateRoadmapChanges(
            rc.changes,
            changeStartGrid,
            changeEndGrid,
            rc.doneInfo,
            rc.cancelInfo,
            rc.atRiskInfo,
            rc.newStoryInfo,
            rc.infoInfo,
            rc.transferredOutInfo,
            rc.transferredInInfo,
            rc.proposedInfo,
            shouldPositionBelowFinal,
            storyStartGrid,
            backgroundColor,
            storyId
        );
    }

    // Legacy roadmap-text box that lists timeline changes and status events
    // chronologically next to the story bar. Used only when the user has the
    // "side" status placement enabled; the default hover layout omits this.
    generateRoadmapChanges(
        changes,
        startGrid,
        endGrid,
        doneInfo = null,
        cancelInfo = null,
        atRiskInfo = null,
        newStoryInfo = null,
        infoInfo = null,
        transferredOutInfo = null,
        transferredInInfo = null,
        proposedInfo = null,
        positionBelow = false,
        storyStartGrid = null,
        _backgroundColor = null,
        storyId = null
    ) {
        const isLeftOfStory = storyStartGrid !== null && endGrid <= storyStartGrid;
        const leftSideClass = isLeftOfStory ? ' status-card-left' : '';

        if (
            (!changes || changes.length === 0) &&
            !doneInfo &&
            !cancelInfo &&
            !atRiskInfo &&
            !newStoryInfo &&
            !infoInfo &&
            !transferredOutInfo &&
            !transferredInInfo &&
            !proposedInfo
        )
            return '';

        const allItems = [];

        const generateStatusColumn = ({ glyph, color, date, label, notes, subtitle = '' }) => `
            <div class="roadmap-column status-card-column${leftSideClass}" style="--status-color: ${color};">
                <div class="status-card-header">
                    <span class="status-mini-badge">${glyph}</span>
                    <span>${this.formatDateEuropean(date)}${label ? ` · ${label}` : ''}</span>
                </div>
                ${subtitle ? `<div class="roadmap-change">${subtitle}</div>` : ''}
                ${notes ? `<div class="roadmap-description">${this.formatText(notes)}</div>` : ''}
            </div>`;

        if (changes && changes.length > 0) {
            changes.forEach((change) => {
                const startMoved =
                    change.prevStartDate &&
                    change.newStartDate &&
                    change.prevStartDate !== change.newStartDate;
                const endMoved =
                    change.prevEndDate &&
                    change.newEndDate &&
                    change.prevEndDate !== change.newEndDate;

                const movement = (prev, next) =>
                    `<del>${this.formatDateEuropean(prev)}</del> <span aria-hidden="true">→</span> <strong>${this.formatDateEuropean(next)}</strong>`;

                const displayParts = [];
                if (startMoved)
                    displayParts.push(
                        `Start ${movement(change.prevStartDate, change.newStartDate)}`
                    );
                if (endMoved)
                    displayParts.push(
                        `${startMoved ? 'End ' : ''}${movement(change.prevEndDate, change.newEndDate)}`
                    );
                if (displayParts.length === 0)
                    displayParts.push(movement(change.prevEndDate, change.newEndDate));
                allItems.push({
                    date: change.date,
                    html: generateStatusColumn({
                        glyph: '↻',
                        color: STATUS_COLORS.change,
                        date: change.date,
                        label: 'Moved',
                        subtitle: displayParts.join(' · '),
                        notes: change.description,
                    }),
                });
            });
        }

        if (doneInfo && (doneInfo.date || doneInfo.notes)) {
            allItems.push({
                date: doneInfo.date,
                html: generateStatusColumn({
                    glyph: '✓',
                    color: STATUS_COLORS.done,
                    date: doneInfo.date,
                    label: 'Done',
                    notes: doneInfo.notes,
                }),
            });
        }

        if (cancelInfo && (cancelInfo.date || cancelInfo.notes)) {
            allItems.push({
                date: cancelInfo.date,
                html: generateStatusColumn({
                    glyph: '✕',
                    color: STATUS_COLORS.cancel,
                    date: cancelInfo.date,
                    label: 'Cancelled',
                    notes: cancelInfo.notes,
                }),
            });
        }

        if (atRiskInfo && (atRiskInfo.date || atRiskInfo.notes)) {
            allItems.push({
                date: atRiskInfo.date,
                html: generateStatusColumn({
                    glyph: '!',
                    color: STATUS_COLORS.atRisk,
                    date: atRiskInfo.date,
                    label: 'At risk',
                    notes: atRiskInfo.notes,
                }),
            });
        }

        if (newStoryInfo && (newStoryInfo.date || newStoryInfo.notes)) {
            allItems.push({
                date: newStoryInfo.date,
                html: generateStatusColumn({
                    glyph: '★',
                    color: STATUS_COLORS.newStory,
                    date: newStoryInfo.date,
                    label: 'New',
                    notes: newStoryInfo.notes,
                }),
            });
        }

        if (infoInfo) {
            if (Array.isArray(infoInfo)) {
                infoInfo.forEach((entry) => {
                    if (entry && (entry.date || entry.notes)) {
                        allItems.push({
                            date: entry.date,
                            html: generateStatusColumn({
                                glyph: 'i',
                                color: STATUS_COLORS.info,
                                date: entry.date,
                                label: 'Info',
                                notes: entry.notes,
                            }),
                        });
                    }
                });
            } else if (infoInfo.date || infoInfo.notes) {
                allItems.push({
                    date: infoInfo.date,
                    html: generateStatusColumn({
                        glyph: 'i',
                        color: STATUS_COLORS.info,
                        date: infoInfo.date,
                        label: 'Info',
                        notes: infoInfo.notes,
                    }),
                });
            }
        }

        if (transferredInInfo && (transferredInInfo.date || transferredInInfo.notes)) {
            allItems.push({
                date: transferredInInfo.date,
                html: generateStatusColumn({
                    glyph: '←',
                    color: STATUS_COLORS.transfer,
                    date: transferredInInfo.date,
                    label: 'In',
                    notes: transferredInInfo.notes,
                }),
            });
        }

        if (transferredOutInfo && (transferredOutInfo.date || transferredOutInfo.notes)) {
            allItems.push({
                date: transferredOutInfo.date,
                html: generateStatusColumn({
                    glyph: '→',
                    color: STATUS_COLORS.transfer,
                    date: transferredOutInfo.date,
                    label: 'Out',
                    notes: transferredOutInfo.notes,
                }),
            });
        }

        if (proposedInfo && (proposedInfo.date || proposedInfo.notes)) {
            allItems.push({
                date: proposedInfo.date,
                html: generateStatusColumn({
                    glyph: '?',
                    color: STATUS_COLORS.proposed,
                    date: proposedInfo.date,
                    label: 'Proposed',
                    notes: proposedInfo.notes,
                }),
            });
        }

        allItems.sort((a, b) => DateUtility.compareDates(a.date, b.date));
        const allItemsHTML = allItems.map((item) => item.html).join('');

        const effectiveBelow = this.isForceTextBelow() ? true : positionBelow;
        const gridRow = effectiveBelow ? 2 : 1;
        const marginStyle = effectiveBelow ? '' : 'margin-top: 1px; ';
        const textBoxWidth = endGrid - startGrid;
        const zoomLevel = ConfigUtility.getZoomLevel(textBoxWidth, startGrid, endGrid);
        const zoomClass = ` story-zoom-${zoomLevel}`;
        const belowClass = effectiveBelow ? ' roadmap-text-below' : '';

        return `
        <div class="roadmap-text roadmap-text-simple${zoomClass}${belowClass}"
             style="--start: ${startGrid}; --end: ${endGrid}; grid-row: ${gridRow}; ${marginStyle}"
             data-story-id="${storyId || ''}">
            <div class="roadmap-columns">
                ${allItemsHTML}
            </div>
        </div>`;
    }

    // Generate BTL date added text box
    generateBTLDateAddedBox(story, _storyIndex, _totalEpics, _ktloPosition) {
        // Calculate story positioning to determine text box placement
        const startValue = story.startDate || story.startMonth;

        // Use effective end date that considers timeline changes for BTL positioning too
        const effectiveEndValue = this.getEffectiveEndDate(story);
        const effectiveEndIsDate = this.isEffectiveEndDateADate(story);

        let startGrid;
        // Handle multi-year stories - if story starts before roadmap year, position at January
        if (story.startDate) {
            try {
                let isoStartDate = story.startDate;
                if (story.startDate.match(/^\d{1,2}[-/]\d{1,2}([-/]\d{2,4})?$/)) {
                    isoStartDate = this.convertEuropeanToISO(story.startDate);
                }
                const startDate = new Date(isoStartDate);
                if (!isNaN(startDate.getTime()) && startDate.getFullYear() < this.roadmapYear) {
                    // Story starts before roadmap year - position at January
                    startGrid = this.getGridPosition('JAN');
                    // Add flag for BTL stories that start in previous year
                    story._startsInPreviousYear = true;
                    story._actualStartYear = startDate.getFullYear();
                } else {
                    startGrid = this.getGridPosition(startValue);
                }
            } catch {
                startGrid = this.getGridPosition(startValue);
            }
        } else {
            startGrid = this.getGridPosition(startValue);
        }
        let endGrid;

        if (effectiveEndValue) {
            // Check if this is an end-of-month date (26th-31st) or end of previous month (1st-3rd)
            const isEndOfMonth = effectiveEndIsDate && DateUtility.isEndOfMonth(effectiveEndValue);
            const isEndOfPreviousMonth =
                effectiveEndIsDate && DateUtility.isEndOfPreviousMonth(effectiveEndValue);

            if (!effectiveEndIsDate) {
                // Month name: position at month start + 10 to span full month
                endGrid = this.getGridPosition(effectiveEndValue) + 10;
            } else if (isEndOfMonth) {
                // End of month: treat like month name - position at month start + 10
                const parsedEndDate = this.parseDateSafe(effectiveEndValue);
                const monthName = this.getMonthName(parsedEndDate.getMonth() + 1);
                endGrid = this.getGridPosition(monthName) + 10;
            } else if (isEndOfPreviousMonth) {
                // End of previous month (1st-3rd): treat as end of previous month
                const previousMonthName = DateUtility.getPreviousMonthName(effectiveEndValue);
                endGrid = this.getGridPosition(previousMonthName) + 10;
            } else {
                endGrid = this.getGridPosition(effectiveEndValue);
            }
        } else {
            endGrid = startGrid + 10; // Default to one month width
        }

        // Calculate text box positioning - place after story end
        const textBoxWidth = ConfigUtility.calculateTextBoxWidth(1); // BTL text boxes always have 1 item (date added)
        let textStartGrid = endGrid + 2; // Small buffer after story
        let textEndGrid = textStartGrid + textBoxWidth;
        let positionBelow = false;

        // If text box would extend past December, position it below the story instead of to the left
        if (ConfigUtility.exceedsMaxGrid(textEndGrid)) {
            positionBelow = true;
            textStartGrid = startGrid + 1; // Slight indent from story start
            textEndGrid = textStartGrid + textBoxWidth;

            // If still too wide when below, adjust to fit
            if (ConfigUtility.exceedsMaxGrid(textEndGrid)) {
                const overflow = textEndGrid - ConfigUtility.getMaxGrid();
                textStartGrid = Math.max(1, textStartGrid - overflow);
                textEndGrid = textStartGrid + textBoxWidth;
            }
        }

        // Format the date for display (European format)
        const formattedDate = this.formatDateEuropean(story.dateAdded);

        // Generate description line only if it exists
        const descriptionHTML = story.dateAddedDescription
            ? `<div class="roadmap-description">${this.formatText(story.dateAddedDescription)}</div>`
            : '';

        // Generate text box HTML similar to timeline changes
        const gridRow = positionBelow ? 2 : 1;
        const belowClass = positionBelow ? ' roadmap-text-below' : '';
        const textBoxHTML = `
        <div class="roadmap-text roadmap-text-simple story-non-zoomable${belowClass}" 
             style="--start: ${textStartGrid}; --end: ${textEndGrid}; grid-row: ${gridRow};">
            <div class="roadmap-columns">
                <div class="roadmap-column status-card-column status-card-left" style="--status-color: ${STATUS_COLORS.added};">
                    <div class="status-card-header">
                        <span class="status-mini-badge">+</span>
                        <span>${formattedDate} · Added</span>
                    </div>
                    ${descriptionHTML}
                </div>
            </div>
        </div>`;

        return textBoxHTML;
    }

    // Generate BTL (Below the Line) special swimlane
    generateBTLSwimlane(btlData, totalEpics = 0, embedded = false, ktloPosition = 'top') {
        // Skip BTL generation entirely if no stories
        if (!btlData || !btlData.stories || btlData.stories.length === 0) {
            return '';
        }

        // BTL stories (if any) - simple stories with dateAdded text boxes
        let storiesHTML = '';
        if (btlData && btlData.stories && btlData.stories.length > 0) {
            btlData.stories.forEach((story, storyIndex) => {
                const storyHTML = this.generateStory(story, 'Below the Line', storyIndex, embedded);

                // Generate text box for BTL stories with dateAdded field
                let dateAddedHTML = '';
                if (story.dateAdded) {
                    dateAddedHTML = this.generateBTLDateAddedBox(
                        story,
                        storyIndex,
                        totalEpics,
                        ktloPosition
                    );
                }

                storiesHTML += `<div class="story-track">${storyHTML}${dateAddedHTML}</div>`;
            });
        }

        // Calculate BTL background color based on its actual position in the visual order
        // BTL is always at the very bottom, so its position depends on total sections above it
        let btlVisualPosition;
        if (ktloPosition === 'top') {
            // Order: KTLO (0), EPIC1 (1), EPIC2 (2), ..., BTL (totalEpics + 1)
            btlVisualPosition = totalEpics + 1;
        } else if (ktloPosition === 'hidden') {
            // Order: EPIC1 (0), EPIC2 (1), ..., BTL (totalEpics) - KTLO is not rendered
            btlVisualPosition = totalEpics;
        } else {
            // Order: EPIC1 (0), EPIC2 (1), ..., KTLO (totalEpics), BTL (totalEpics + 1)
            btlVisualPosition = totalEpics + 1;
        }

        const btlBackgroundColor = UIUtility.getAlternatingBackgroundColor(btlVisualPosition);
        const bandClass = btlVisualPosition % 2 === 0 ? 'swimlane-even' : 'swimlane-odd';

        return `
        <div class="swimlane btl-swimlane ${bandClass}">
            <div class="epic-label">Below the Line</div>
                            <div class="swimlane-content" style="background-color: ${btlBackgroundColor}; min-height: 150px;">
                ${this.generateTimelineGrid()}
                ${storiesHTML}
            </div>
        </div>`;
    }

    // Generate KTLO special swimlane
    generateKTLOSwimlane(ktloData, totalEpics = 0, embedded = false, ktloPosition = 'top') {
        const bulletsHTML = UIUtility.generateBulletsHTML(ktloData.story.bullets, (text) =>
            this.formatText(text)
        );

        // KTLO spans the entire year (120 grid units), so it gets the 'tiny' zoom level
        const ktloWidth = 120; // Full year
        const zoomLevel = ConfigUtility.getZoomLevel(ktloWidth);
        const zoomClass = ` story-zoom-${zoomLevel}`;

        // Add edit and move icons only in embedded mode (builder view) - KTLO doesn't need move icons since it's always alone
        const editIconHTML = UIUtility.generateEditIconHTML(
            embedded,
            'KTLO',
            ktloData.story.title,
            0,
            (text) => this.formatText(text)
        );

        const ktloStoryHTML = `
        <div class="story-track">
            <div class="ktlo-story${zoomClass}" 
                 data-epic-name="KTLO" 
                 data-story-title="${(ktloData.story.title || '').replace(/"/g, '&quot;')}" 
                 data-story-index="0"
                 data-story-id="">
                ${editIconHTML}
                                    <div class="task-title">${this.formatText(ktloData.story.title)}</div>
                ${bulletsHTML}
            </div>
        </div>`;

        // Calculate background color based on visual position in roadmap
        // When KTLO is at top: KTLO=0, EPIC1=1, EPIC2=2, etc.
        // When KTLO is at bottom: EPIC1=0, EPIC2=1, KTLO=N, BTL=N+1
        const visualPosition = ktloPosition === 'top' ? 0 : totalEpics;
        const ktloBackgroundColor = UIUtility.getAlternatingBackgroundColor(visualPosition); // Even = lime, odd = brown
        const bandClass = visualPosition % 2 === 0 ? 'swimlane-even' : 'swimlane-odd';

        const monthlyBoxesHTML = ktloData.monthlyData
            .map((monthData, index) => {
                // Get transform configuration from ConfigUtility
                const transform = ConfigUtility.getMonthlyBoxTransform(index);
                const startColumn =
                    index * ConfigUtility.GRID.COLUMNS_PER_MONTH + transform.startColumn;
                const endColumn = startColumn + 9; // Use 9 columns (20% bigger than 8)
                const extraStyle = ConfigUtility.generateTransform(transform.x);
                const extraClass = transform.extraClass;

                // Get month name for header
                const monthName = this.months[index]; // JAN, FEB, MAR, etc.

                // Add edit icon and single-click handler for entire box in embedded mode
                const editIconHTML = embedded
                    ? `<div class="monthly-edit-icon" title="Edit ${monthName} KTLO">✎</div>`
                    : '';
                const clickHandler = embedded
                    ? ` onclick="parent.openEditMonthlyKTLOModal('${monthName.toLowerCase()}')"`
                    : '';

                return `
            <div class="monthly-box${extraClass}" style="grid-column: ${startColumn} / ${endColumn}; ${extraStyle}">
                <div class="monthly-box-content"${clickHandler} style="cursor: ${embedded ? 'pointer' : 'default'};">
                    ${editIconHTML}
                    <div class="monthly-box-header">${monthName}</div>
                    <div class="monthly-box-numbers">${monthData.number} / ${monthData.percentage}%</div>
                    <div class="monthly-box-description">${this.formatMonthlyDescription(monthData.description)}</div>
                </div>
            </div>
        `;
            })
            .join('');

        return `
        <div class="swimlane special-swimlane ${bandClass}">
            <div class="epic-label">KTLO</div>
                            <div class="swimlane-content" style="background-color: ${ktloBackgroundColor}; padding-bottom: 10px;">
                ${this.generateTimelineGrid()}
                ${ktloStoryHTML}
                <div class="monthly-boxes-container">
                    ${monthlyBoxesHTML}
                </div>
            </div>
        </div>`;
    }

    // Generate a single EPIC swimlane
    generateEpic(epic, epicIndex, embedded = false, ktloPosition = 'top') {
        // Calculate background color based on visual position in roadmap
        // When KTLO is at top: KTLO=0, EPIC1=1, EPIC2=2, etc.
        // When KTLO is at bottom: EPIC1=0, EPIC2=1, KTLO=N, BTL=N+1
        const visualPosition = ktloPosition === 'top' ? epicIndex + 1 : epicIndex;
        const backgroundColor = UIUtility.getAlternatingBackgroundColor(visualPosition); // Even = lime, odd = brown
        const bandClass = visualPosition % 2 === 0 ? 'swimlane-even' : 'swimlane-odd';

        let tracksHTML = '';

        // Optionally sort stories by start date first, then by end date as secondary sort
        const storiesToProcess = ConfigUtility.shouldSortStories()
            ? [...epic.stories].sort((a, b) => {
                  // Get start values (date or month)
                  const aStart = a.startDate || a.startMonth || 'JAN';
                  const bStart = b.startDate || b.startMonth || 'JAN';

                  // Get end values (use effective end date that considers timeline changes)
                  const aEnd = this.getEffectiveEndDate(a) || a.endDate || a.endMonth || 'MAR';
                  const bEnd = this.getEffectiveEndDate(b) || b.endDate || b.endMonth || 'MAR';

                  // Primary sort: by start date (handles both dates and months)
                  const startComparison = DateUtility.compareDateOrMonth(
                      aStart,
                      bStart,
                      this.roadmapYear
                  );
                  if (startComparison !== 0) {
                      return startComparison;
                  }

                  // Secondary sort: by end date (if start dates are the same)
                  return DateUtility.compareDateOrMonth(aEnd, bEnd, this.roadmapYear);
              })
            : epic.stories;

        storiesToProcess.forEach((story, storyIndex) => {
            const storyHTML = this.generateStory(
                story,
                epic.name,
                storyIndex,
                embedded,
                backgroundColor,
                epic.epicId || ''
            );
            // Side status text box is always rendered. The beta toggle adds the
            // hover popover + milestone track inside the story bar on top of it.
            const sideStatusHTML = this.generateSideStatusTextBox(
                story,
                epic.name,
                storyIndex,
                backgroundColor
            );
            tracksHTML += `<div class="story-track">${storyHTML}${sideStatusHTML}</div>`;
        });

        return `
        <div class="swimlane ${bandClass}">
            <div class="epic-label">${this.truncateEpicName(epic.name, epic.stories.length)}</div>
                            <div class="swimlane-content" style="background-color: ${backgroundColor};">
                ${this.generateTimelineGrid()}
                ${tracksHTML}
            </div>
        </div>`;
    }

    // Generate just the roadmap body markup (header + container).
    // No CSS link, no <html>/<body> wrapper, no inline edit script.
    // Use this for v2 in-page rendering into a `.roadmap-root` mount.
    generateRoadmapBody(teamData, embedded = true) {
        // Store search range for date range searches (used by continuation logic)
        this.searchRange = teamData.searchRange || null;

        const ktloPosition = teamData.ktloSwimlane?.position || 'bottom';

        let ktloHTML = '';
        if (teamData.ktloSwimlane && ktloPosition === 'top') {
            ktloHTML = this.generateKTLOSwimlane(teamData.ktloSwimlane, 0, embedded, ktloPosition);
        }

        const epicsHTML = teamData.epics
            .map((epic, index) => {
                const separatorHTML = index === 0 ? '' : '<div class="swimlane-separator"></div>';
                return separatorHTML + this.generateEpic(epic, index, embedded, ktloPosition);
            })
            .join('');

        let bottomHTML = '';
        if (teamData.ktloSwimlane && ktloPosition === 'bottom') {
            bottomHTML += '<div class="swimlane-separator"></div>';
            bottomHTML += this.generateKTLOSwimlane(
                teamData.ktloSwimlane,
                teamData.epics.length,
                embedded,
                ktloPosition
            );
        }
        const btlHTML = this.generateBTLSwimlane(
            teamData.btlSwimlane,
            teamData.epics.length,
            embedded,
            ktloPosition
        );
        if (btlHTML) {
            bottomHTML += '<div class="swimlane-separator-dashed"></div>';
            bottomHTML += btlHTML;
        }

        const containerClasses = [
            'roadmap-container',
            this.isEpicTitleTop() ? 'roadmap-epic-title-top' : '',
            this.isStoryTextHidden() ? 'roadmap-hide-story-text' : '',
        ]
            .filter(Boolean)
            .join(' ');

        const logoSrc = 'teya-logo.png';
        return `
            <div class="header">
                <img src="${logoSrc}" alt="Teya Logo" class="teya-logo">
                <div class="team-heading-row">
                    <div class="team-name">${teamData.teamName}</div>
                    ${teamData.em || teamData.pm ? `<div class="team-members">${teamData.em ? `${teamData.em} <span class="team-member-role">EM</span>` : ''}${teamData.em && teamData.pm ? ' &nbsp;·&nbsp; ' : ''}${teamData.pm ? `${teamData.pm} <span class="team-member-role">PM</span>` : ''}</div>` : ''}
                </div>
                ${
                    teamData.description
                        ? `<div class="team-description">${this.generateTeamDescription(teamData.description)}</div>`
                        : ''
                }
            </div>

            <div class="${containerClasses}">
                ${this.generateTimelineHeader()}
                <div class="swimlanes-container">
                    ${ktloHTML}
                    ${epicsHTML}
                    ${bottomHTML}
                    ${this.generateTodayLine()}
                </div>
            </div>

            `;
    }

    // Generate complete roadmap HTML (full document for export, or wrapped fragment for legacy embedded use).
    generateRoadmap(teamData, embedded = false, enableEditing = true, fixedWidth = false) {
        const roadmapContent = this.generateRoadmapBody(teamData, embedded);

        if (embedded) {
            return `<div class="roadmap-wrapper roadmap-root">${this.generateCSS(fixedWidth)}${roadmapContent}</div>`;
        }

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${teamData.teamName}.Teya.Roadmap.${teamData.roadmapYear || 2025}</title>
            ${this.generateCSS(fixedWidth)}
        </head>
        <body class="roadmap-root">
            ${roadmapContent}
            
            <script>
                let selectedStory = null;
                
                // Add click event listeners to all story items
                document.addEventListener('DOMContentLoaded', function() {
                    const storyItems = document.querySelectorAll('.story-item, .ktlo-story');
                    
                    // January/December hover now handled by CSS
                    

                    ${
                        enableEditing
                            ? `
                    storyItems.forEach((story, index) => {
                        // Add single-click event listener to open edit dialog
                        story.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            selectedStory = {
                                epicName: this.dataset.epicName,
                                storyTitle: this.dataset.storyTitle,
                                storyIndex: this.dataset.storyIndex,
                                element: this
                            };
                            
                            // Call the edit function
                            editStory();
                        });
                        
                        // Visual indicator for clickable stories
                        story.style.cursor = 'pointer';
                    });`
                            : `
                    // Editing disabled - no click event listeners added
                    storyItems.forEach((story, index) => {
                        // Remove pointer cursor for non-editable stories
                        story.style.cursor = 'default';
                    });`
                    }
                    

                    
                });
                
                
                function editStory() {
                    if (!selectedStory) return;

                    // Open roadmap builder with story details
                    const builderUrl = '/builder';
                    const params = new URLSearchParams({
                        action: 'edit',
                        epic: selectedStory.epicName,
                        story: selectedStory.storyTitle,
                        index: selectedStory.storyIndex
                    });

                    window.open(builderUrl + '?' + params.toString(), '_blank');
                }

                // Milestone label collision pass: greedy row assignment so
                // close-together pins in the milestones track don't overlap.
                // Mirrors RoadmapGenerator.layoutMilestoneLabels for standalone
                // exports / iframes that don't load the module class.
                function layoutMilestoneLabels() {
                    const tracks = document.querySelectorAll('.story-milestones-track');
                    const BUFFER_PX = 4;
                    const ROW_STEP_PX = 50;
                    tracks.forEach(function (track) {
                        const slots = Array.from(track.querySelectorAll('.milestone-pin-slot'));
                        if (slots.length === 0) return;
                        slots.forEach(function (s) { s.style.setProperty('--milestone-row', '0'); });
                        const measured = slots.map(function (slot) {
                            const popover = slot.querySelector('.milestone-pin-popover');
                            if (!popover) return null;
                            const rect = popover.getBoundingClientRect();
                            return { slot: slot, left: rect.left, right: rect.right };
                        }).filter(Boolean).sort(function (a, b) { return a.left - b.left; });
                        const rows = [];
                        for (const item of measured) {
                            let row = 0;
                            while (row < 50) {
                                if (!rows[row]) rows[row] = [];
                                const conflicts = rows[row].some(function (r) {
                                    return item.left < r.right + BUFFER_PX && item.right + BUFFER_PX > r.left;
                                });
                                if (!conflicts) {
                                    rows[row].push({ left: item.left, right: item.right });
                                    item.slot.style.setProperty('--milestone-row', String(row));
                                    break;
                                }
                                row++;
                            }
                        }

                        let layer = track.querySelector(':scope > .milestone-connectors');
                        if (!layer) {
                            layer = document.createElement('div');
                            layer.className = 'milestone-connectors';
                            track.insertBefore(layer, track.firstChild);
                        }
                        layer.replaceChildren();
                        slots.forEach(function (slot) {
                            const row = parseInt(slot.style.getPropertyValue('--milestone-row') || '0', 10);
                            if (!row) return;
                            const conn = document.createElement('span');
                            conn.className = 'milestone-pin-connector';
                            conn.style.left = slot.style.left || '0%';
                            conn.style.height = (row * ROW_STEP_PX + 6) + 'px';
                            conn.style.setProperty('--milestone-color', slot.style.getPropertyValue('--milestone-color') || 'currentColor');
                            layer.appendChild(conn);
                        });
                    });
                }
                document.addEventListener('DOMContentLoaded', function () {
                    requestAnimationFrame(layoutMilestoneLabels);
                });
                let __milestoneResizeScheduled = false;
                window.addEventListener('resize', function () {
                    if (__milestoneResizeScheduled) return;
                    __milestoneResizeScheduled = true;
                    requestAnimationFrame(function () {
                        __milestoneResizeScheduled = false;
                        layoutMilestoneLabels();
                    });
                });

            </script>
        </body>
        </html>`;
    }

    // Generate roadmap for embedding in existing pages
    generateEmbeddedRoadmap(teamData, enableEditing = true, fixedWidth = false) {
        return this.generateRoadmap(teamData, true, enableEditing, fixedWidth);
    }

    // Greedy collision pass for milestone labels. Each pin starts at row 0;
    // any label whose horizontal extent overlaps an already-placed label in
    // the same row is bumped to the next free row. Sets --milestone-row on
    // the slot, which CSS uses to vertical-offset the label. Connector
    // lines from pin to staggered label are drawn into a per-track
    // .milestone-connectors layer that sits behind every slot, so the line
    // never paints over a neighbouring label. Idempotent.
    static layoutMilestoneLabels(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const tracks = root.querySelectorAll('.story-milestones-track');
        const BUFFER_PX = 4;
        const ROW_STEP_PX = 50;
        tracks.forEach((track) => {
            const slots = Array.from(track.querySelectorAll('.milestone-pin-slot'));
            if (slots.length === 0) return;
            slots.forEach((slot) => slot.style.setProperty('--milestone-row', '0'));
            const measured = slots
                .map((slot) => {
                    const popover = slot.querySelector('.milestone-pin-popover');
                    if (!popover) return null;
                    const rect = popover.getBoundingClientRect();
                    return { slot, left: rect.left, right: rect.right };
                })
                .filter(Boolean)
                .sort((a, b) => a.left - b.left);
            const rows = [];
            for (const item of measured) {
                let row = 0;
                while (row < 50) {
                    if (!rows[row]) rows[row] = [];
                    const conflicts = rows[row].some(
                        (r) => item.left < r.right + BUFFER_PX && item.right + BUFFER_PX > r.left
                    );
                    if (!conflicts) {
                        rows[row].push({ left: item.left, right: item.right });
                        item.slot.style.setProperty('--milestone-row', String(row));
                        break;
                    }
                    row++;
                }
            }

            let layer = track.querySelector(':scope > .milestone-connectors');
            if (!layer) {
                layer = track.ownerDocument.createElement('div');
                layer.className = 'milestone-connectors';
                track.insertBefore(layer, track.firstChild);
            }
            layer.replaceChildren();
            slots.forEach((slot) => {
                const row = parseInt(slot.style.getPropertyValue('--milestone-row') || '0', 10);
                if (!row) return;
                const conn = track.ownerDocument.createElement('span');
                conn.className = 'milestone-pin-connector';
                conn.style.left = slot.style.left || '0%';
                conn.style.height = `${row * ROW_STEP_PX + 6}px`;
                conn.style.setProperty(
                    '--milestone-color',
                    slot.style.getPropertyValue('--milestone-color') || 'currentColor'
                );
                layer.appendChild(conn);
            });
        });
    }
}

// Auto-run the milestone layout pass whenever roadmap content appears or the
// viewport resizes. Operates on the document so it works for the main app
// and inside roadmap iframes (each iframe loads its own copy of this file).
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            RoadmapGenerator.layoutMilestoneLabels(document);
        });
    };
    const containsTrack = (node) =>
        node.nodeType === 1 &&
        (node.matches?.('.story-milestones-track') ||
            node.querySelector?.('.story-milestones-track'));
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (containsTrack(node)) {
                    schedule();
                    return;
                }
            }
        }
    });
    const start = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    window.addEventListener('resize', schedule);
}
