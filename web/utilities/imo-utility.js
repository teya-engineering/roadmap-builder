import { europeanToIso, ISO_DATE_REGEX } from '../domain/dates.js';

const MONTH_INDEX = Object.freeze({
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
});

function normalizeYear(value, fallback = new Date().getFullYear()) {
    const year = Number(value ?? fallback);
    if (!Number.isInteger(year)) return null;
    return year < 100 ? year + 2000 : year;
}

function createLocalDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
        ? date
        : null;
}

function storyKey(story) {
    return JSON.stringify([story.teamName, story.title]);
}

/**
 * IMO Utility - Cross-Team IMO and Timeline Search Functionality
 * Handles directory scanning, story extraction, and filtering across multiple roadmap files
 */
export class IMOUtility {
    static scanCache = new WeakMap();

    /**
     * Scan a directory handle and extract all roadmap JSON files.
     * Results are cached per directory handle; pass {refresh: true} to force a rescan.
     * @param {FileSystemDirectoryHandle} directoryHandle
     * @param {{refresh?: boolean}} [options]
     * @returns {Promise<Array>}
     */
    static async scanRoadmapDirectory(directoryHandle, { refresh = false } = {}) {
        if (!refresh && this.scanCache.has(directoryHandle)) {
            return this.scanCache.get(directoryHandle);
        }

        const jsonHandles = [];
        try {
            for await (const [name, handle] of directoryHandle.entries()) {
                if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) {
                    jsonHandles.push([name, handle]);
                }
            }
        } catch (error) {
            console.error('Error scanning directory:', error);
            throw new Error('Failed to scan roadmap directory: ' + error.message);
        }

        const results = await Promise.all(
            jsonHandles.map(async ([name, handle]) => {
                try {
                    const file = await handle.getFile();
                    const content = await file.text();
                    const roadmapData = JSON.parse(content);
                    const teamData = roadmapData.teamData || roadmapData;
                    if (teamData && teamData.teamName) {
                        return {
                            fileName: name,
                            fileContent: content,
                            teamData,
                            fileHandle: handle,
                        };
                    }
                    return null;
                } catch (error) {
                    console.warn(`Skipping invalid JSON file: ${name}`, error);
                    return null;
                }
            })
        );

        const roadmapFiles = results
            .filter(Boolean)
            .sort((a, b) => a.fileName.localeCompare(b.fileName));

        this.scanCache.set(directoryHandle, roadmapFiles);
        return roadmapFiles;
    }

    static clearScanCache(directoryHandle) {
        if (directoryHandle) {
            this.scanCache.delete(directoryHandle);
        }
    }

    /**
     * Extract all stories from a single roadmap's team data
     * @param {Object} teamData - Team data object from roadmap JSON
     * @param {string} teamName - Name of the team (for reference)
     * @returns {Array} - Array of story objects with team context
     */
    static extractStoriesFromRoadmap(teamData, teamName) {
        const stories = [];

        // Stories flagged with hideFromSearch are excluded from cross-team search.
        // Missing/false values keep the legacy behaviour, so older roadmaps stay visible.
        const isVisible = (story) =>
            story &&
            typeof story === 'object' &&
            story.title &&
            story.title.trim() &&
            story.hideFromSearch !== true;

        // Extract stories from epics
        if (teamData.epics && Array.isArray(teamData.epics)) {
            teamData.epics.forEach((epic) => {
                if (epic.stories && Array.isArray(epic.stories)) {
                    epic.stories.forEach((story) => {
                        if (isVisible(story)) {
                            stories.push({
                                ...story,
                                teamName: teamName,
                                epicName: epic.name || 'Unknown Epic',
                                sourceType: 'epic',
                            });
                        }
                    });
                }
            });
        }

        // Extract BTL stories
        if (
            teamData.btlStories &&
            teamData.btlStories.stories &&
            Array.isArray(teamData.btlStories.stories)
        ) {
            teamData.btlStories.stories.forEach((story) => {
                if (isVisible(story)) {
                    stories.push({
                        ...story,
                        teamName: teamName,
                        epicName: 'BTL', // BTL stories don't have epics
                        sourceType: 'btl',
                    });
                }
            });
        }

        return stories;
    }

    /**
     * Filter stories by IMO/Project ID
     * - If search term is purely numeric: match it anywhere in the IMO value
     * - Text or a term ending in "*" matches the start of the ID
     * - "!" excludes a term; "&&" combines filters; "||" combines positive alternatives
     * @param {Array} stories - Array of story objects
     * @param {string} imoSearch - IMO/Project ID to search for or "all" for any IMO
     * @returns {Array} - Filtered array of stories with matching IMO or all stories with any IMO
     */
    static filterStoriesByIMO(stories, imoSearch) {
        if (!imoSearch || !Array.isArray(stories)) return [];

        const groups = imoSearch
            .toString()
            .trim()
            .toLowerCase()
            .split('&&')
            .map((group) => {
                const terms = group.split('||').map((term) => {
                    const trimmed = term.trim();
                    const negated = trimmed.startsWith('!');
                    const value = (negated ? trimmed.slice(1) : trimmed).trim();
                    const prefix = value.endsWith('*') ? value.slice(0, -1) : value;
                    return { negated, value, prefix, numeric: /^\d+$/.test(value) };
                });
                return {
                    positive: terms.filter((term) => !term.negated),
                    negative: terms.filter((term) => term.negated),
                    valid: terms.every((term) => term.value.length > 0),
                };
            });
        if (groups.some((group) => !group.valid)) return [];

        return stories.filter((story) => {
            const storyIMO = (story.imo || '').toString().trim().toLowerCase();
            const matches = (term) => {
                if (!storyIMO) return false;
                if (term.value === 'all') return true;
                return term.numeric
                    ? storyIMO.includes(term.value)
                    : storyIMO.startsWith(term.prefix);
            };

            // Exclusions apply to every alternative, as in the general search query syntax.
            return groups.every(
                (group) =>
                    (group.positive.length === 0 || group.positive.some(matches)) &&
                    !group.negative.some(matches)
            );
        });
    }

    /**
     * Filter stories that have any IMO tag
     * @param {Array} stories - Array of story objects
     * @returns {Array} - Filtered array of stories that have any IMO tag
     */
    static filterStoriesWithAnyIMO(stories) {
        if (!Array.isArray(stories)) return [];

        return stories.filter((story) => {
            return story.imo && story.imo.toString().trim() !== '';
        });
    }

    /**
     * Filter stories by timeline (quarter, month, or date)
     * @param {Array} stories - Array of story objects
     * @param {string} timeline - Timeline to search for (e.g., "Q3", "April", "Mar 2025")
     * @returns {Array} - Filtered array of stories ending in specified timeline
     */
    static filterStoriesByTimeline(stories, timeline) {
        if (!timeline || !Array.isArray(stories)) return [];

        const searchTerm = timeline.toString().trim().toLowerCase();

        return stories.filter((story) => {
            // Check end date/month
            if (story.endDate || story.endMonth) {
                const endValue = (story.endDate || story.endMonth || '').toString().toLowerCase();

                // Quarter matching (Q1, Q2, Q3, Q4)
                if (searchTerm.startsWith('q') && searchTerm.length === 2) {
                    const quarter = this.getQuarterFromDate(endValue);
                    if (quarter === searchTerm) return true;
                }

                // Month or year matching (partial or full)
                if (endValue.includes(searchTerm)) return true;
            }

            return false;
        });
    }

    /**
     * Determine which quarter a date/month falls into
     * @param {string} dateStr - Date or month string
     * @returns {string} - Quarter (q1, q2, q3, q4) or empty string if unknown
     */
    static getQuarterFromDate(dateStr) {
        if (!dateStr) return '';

        const str = dateStr.toLowerCase();

        // Q1: Jan, Feb, Mar
        if (
            str.includes('jan') ||
            str.includes('feb') ||
            str.includes('mar') ||
            str.includes('january') ||
            str.includes('february') ||
            str.includes('march')
        ) {
            return 'q1';
        }

        // Q2: Apr, May, Jun
        if (
            str.includes('apr') ||
            str.includes('may') ||
            str.includes('jun') ||
            str.includes('april') ||
            str.includes('june')
        ) {
            return 'q2';
        }

        // Q3: Jul, Aug, Sep
        if (
            str.includes('jul') ||
            str.includes('aug') ||
            str.includes('sep') ||
            str.includes('sept') ||
            str.includes('july') ||
            str.includes('august') ||
            str.includes('september')
        ) {
            return 'q3';
        }

        // Q4: Oct, Nov, Dec
        if (
            str.includes('oct') ||
            str.includes('nov') ||
            str.includes('dec') ||
            str.includes('october') ||
            str.includes('november') ||
            str.includes('december')
        ) {
            return 'q4';
        }

        return '';
    }

    /**
     * Aggregate stories from multiple roadmap files
     * @param {Array} roadmapFiles - Array from scanRoadmapDirectory()
     * @returns {Array} - Combined array of all stories with team context
     */
    static aggregateStoriesAcrossTeams(
        roadmapFiles,
        defaultRoadmapYear = new Date().getFullYear()
    ) {
        const allStories = [];
        const storyMap = new Map(); // Track stories by title+team to handle duplicates

        roadmapFiles.forEach((roadmapFile) => {
            const roadmapYear =
                Number(roadmapFile.teamData.roadmapYear) ||
                Number(defaultRoadmapYear) ||
                new Date().getFullYear();

            const stories = this.extractStoriesFromRoadmap(
                roadmapFile.teamData,
                roadmapFile.teamData.teamName
            );
            stories.forEach((story) => {
                story.sourceFile = roadmapFile.fileName;
                story.fileHandle = roadmapFile.fileHandle;
                story.roadmapYear = roadmapYear; // Add roadmap year to each story
                // Add leadership info for advanced filtering
                story._directorVP = roadmapFile.teamData.directorVP || '';
                story._em = roadmapFile.teamData.em || '';
                story._pm = roadmapFile.teamData.pm || '';

                // Create unique key for duplicate detection
                const key = storyKey(story);

                // Check if we already have this story
                const existingStory = storyMap.get(key);
                if (existingStory) {
                    // Prioritize stories with specific endDate over generic endMonth
                    const currentHasEndDate = story.endDate && story.endDate.trim();
                    const existingHasEndDate =
                        existingStory.endDate && existingStory.endDate.trim();

                    if (currentHasEndDate && !existingHasEndDate) {
                        // Current story has specific date, existing doesn't - use current
                        storyMap.set(key, story);
                    } else if (!currentHasEndDate && existingHasEndDate) {
                        // Existing story has specific date, current doesn't - keep existing
                        // No action needed, keep existing
                    } else {
                        // Both have the same date precision, so keep the latest roadmap.
                        if (story.roadmapYear > existingStory.roadmapYear) {
                            storyMap.set(key, story);
                        }
                        // Otherwise keep existing
                    }
                } else {
                    // New story, add it
                    storyMap.set(key, story);
                }
            });
        });

        // Convert map back to array
        allStories.push(...storyMap.values());

        return allStories;
    }

    /**
     * Filter roadmap files by Director/VP, EM, or PM name (team-level metadata)
     * @param {Array} roadmapFiles - Array from scanRoadmapDirectory()
     * @param {string} query - Case-insensitive substring to search in teamData.directorVP, em, or pm
     * @returns {Array} - Filtered roadmapFiles whose teamData.directorVP, em, or pm matches
     */
    static filterRoadmapsByDirector(roadmapFiles, query) {
        if (!Array.isArray(roadmapFiles) || !query) return [];
        const q = query.toString().trim().toLowerCase();
        if (!q) return [];

        return roadmapFiles.filter((roadmapFile) => {
            const teamData = roadmapFile.teamData || {};
            const director = String(teamData.directorVP || '').toLowerCase();
            const engineeringManager = String(teamData.em || '').toLowerCase();
            const productManager = String(teamData.pm || '').toLowerCase();

            return (
                director.includes(q) || engineeringManager.includes(q) || productManager.includes(q)
            );
        });
    }

    /**
     * Parse search query and determine search type
     * @param {string} query - Search query (e.g., "IMO", "IMO 0043", "IMO Moto", "0043", "Q3", "April")
     * @returns {Object} - {type: 'imo'|'timeline', value: string}
     */
    static parseSearchQuery(query) {
        if (!query || typeof query !== 'string') {
            return { type: null, value: '' };
        }

        const cleanQuery = query.trim();

        // Month names that belong to timeline search - not treated as IMO prefixes
        const MONTH_NAMES =
            /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i;

        // "!XYZ" / "!IMO1" - stories whose IMO field does NOT start with XYZ
        const negatedPrefixMatch = cleanQuery.match(/^!([a-zA-Z][a-zA-Z0-9]{1,7})$/);
        if (negatedPrefixMatch && !MONTH_NAMES.test(negatedPrefixMatch[1])) {
            return { type: 'imo', value: negatedPrefixMatch[1].toLowerCase(), negated: true };
        }

        // CP/Project ID pattern: "CP 0043" or "CP SomeProject" (legacy "IMO 0043" still accepted)
        const imoWithPrefixMatch = cleanQuery.match(/^(?:cp|imo)\s+(.+)$/i);
        if (imoWithPrefixMatch) {
            return { type: 'imo', value: imoWithPrefixMatch[1].trim() };
        }

        const wildcardMatch = cleanQuery.match(/^(!?)\s*([^!*&|]+)\*$/);
        if (wildcardMatch) {
            return {
                type: 'imo',
                value: `${wildcardMatch[2].trim().toLowerCase()}*`,
                negated: wildcardMatch[1] === '!',
            };
        }

        // Bare alphanumeric code starting with a letter (e.g. "IMO", "IMP", "IMO1", "RR") - stories whose IMO field starts with it
        if (
            /^[a-zA-Z][a-zA-Z0-9]{1,7}$/.test(cleanQuery) &&
            !MONTH_NAMES.test(cleanQuery) &&
            !/^q[1-4]$/i.test(cleanQuery)
        ) {
            return { type: 'imo', value: cleanQuery.toLowerCase() };
        }

        // Standalone numeric value - treat as IMO search (e.g., "0043")
        if (/^\d+$/.test(cleanQuery)) {
            return { type: 'imo', value: cleanQuery };
        }

        // EndDate filter: "EndDate=15/Mar/25" or "EndDate=15/03"
        const endDateMatch = cleanQuery.match(/^enddate=(.+)$/i);
        if (endDateMatch) {
            return { type: 'enddate', value: endDateMatch[1].trim() };
        }

        // Quarter pattern: "Q1", "Q2", etc.
        if (/^q[1-4]$/i.test(cleanQuery)) {
            return { type: 'timeline', value: cleanQuery.toLowerCase() };
        }

        // Default to timeline search for anything else (months, dates)
        return { type: 'timeline', value: cleanQuery };
    }

    /**
     * Search stories based on parsed query
     * @param {Array} allStories - Array of all stories from aggregateStoriesAcrossTeams()
     * @param {string} searchQuery - Raw search query string
     * @returns {Array} - Filtered stories matching the search
     */
    static searchStories(allStories, searchQuery) {
        // Support "&&" to combine filters: stories must match ALL terms
        if (searchQuery && searchQuery.includes('&&')) {
            const parts = searchQuery
                .split('&&')
                .map((p) => p.trim())
                .filter(Boolean);
            let result = allStories;
            for (const part of parts) {
                const matched = new Set(this.searchStories(allStories, part).map(storyKey));
                result = result.filter((story) => matched.has(storyKey(story)));
            }
            return result;
        }

        // Support "||" to combine filters: positive terms union, negated terms intersect
        if (searchQuery && searchQuery.includes('||')) {
            const parts = searchQuery
                .split('||')
                .map((p) => p.trim())
                .filter(Boolean);
            const negatedParts = parts.filter((p) => p.startsWith('!'));
            const positiveParts = parts.filter((p) => !p.startsWith('!'));

            let result = [];

            if (positiveParts.length > 0) {
                // Union: stories matching any positive term
                const seen = new Set();
                for (const part of positiveParts) {
                    for (const story of this.searchStories(allStories, part)) {
                        const key = storyKey(story);
                        if (!seen.has(key)) {
                            seen.add(key);
                            result.push(story);
                        }
                    }
                }
            }

            if (negatedParts.length > 0) {
                // Intersection: stories excluded by ALL negated terms (i.e. match none of the positive bases)
                let pool = positiveParts.length > 0 ? result : allStories;
                for (const part of negatedParts) {
                    const excluded = new Set(
                        this.searchStories(allStories, part.slice(1)).map(storyKey)
                    );
                    pool = pool.filter((story) => !excluded.has(storyKey(story)));
                }
                result = pool;
            }

            return result;
        }

        const { type, value, negated } = this.parseSearchQuery(searchQuery);

        if (!type) return [];

        if (type === 'imo') {
            const matches = this.filterStoriesByIMO(allStories, value);
            if (negated) {
                const matchedKeys = new Set(matches.map(storyKey));
                return allStories.filter((story) => !matchedKeys.has(storyKey(story)));
            }
            return matches;
        } else if (type === 'enddate') {
            if (!value) return [];
            return this.filterStoriesByEndDate(allStories, value);
        } else if (type === 'timeline') {
            if (!value) return [];
            return this.filterStoriesByTimeline(allStories, value);
        }

        return [];
    }

    /**
     * Filter stories whose end date matches the given date string exactly.
     * Accepts day/month/year or day/month (e.g. "15/Mar/25", "15/03/25", "15/Mar").
     */
    static filterStoriesByEndDate(stories, dateStr) {
        if (!dateStr || !Array.isArray(stories)) return [];
        const defaultYear =
            Number(stories.find((story) => story.roadmapYear)?.roadmapYear) ||
            new Date().getFullYear();
        const targetISO = this.convertStoryDateToISO(dateStr, defaultYear);
        if (!targetISO) return [];
        return stories.filter((story) => {
            const storyISO = this.convertStoryDateToISO(
                story.endDate || story.endMonth || '',
                story.roadmapYear || defaultYear
            );
            return storyISO === targetISO;
        });
    }

    /**
     * Parse a story date string that may contain month names
     * @param {string} dateStr - Date string (e.g., "15/03/25", "15/AUG/25", "AUG 2025", "AUG")
     * @param {number} defaultYear - Default year to use if not specified
     * @returns {Date|null} - Parsed date or null if invalid
     */
    static parseStoryDate(dateStr, defaultYear = new Date().getFullYear()) {
        if (typeof dateStr !== 'string' || !dateStr.trim()) return null;

        const value = dateStr.trim().toLowerCase();
        const fallbackYear = normalizeYear(defaultYear);
        if (fallbackYear === null) return null;

        if (ISO_DATE_REGEX.test(value)) {
            const [year, month, day] = value.split('-').map(Number);
            return createLocalDate(year, month - 1, day);
        }

        const numericIso = europeanToIso(value, fallbackYear);
        if (numericIso !== value && ISO_DATE_REGEX.test(numericIso)) {
            const [year, month, day] = numericIso.split('-').map(Number);
            return createLocalDate(year, month - 1, day);
        }

        const dayFirst = value.match(/^(\d{1,2})[\s/-]+([a-z]+)(?:[\s/-]+(\d{2,4}))?$/);
        if (dayFirst) {
            const month = MONTH_INDEX[dayFirst[2]];
            const year = normalizeYear(dayFirst[3], fallbackYear);
            return month === undefined ? null : createLocalDate(year, month, Number(dayFirst[1]));
        }

        const monthFirst = value.match(/^([a-z]+)(?:[\s/-]+(\d{1,4}))?(?:[\s/-]+(\d{2,4}))?$/);
        if (!monthFirst) return null;

        const month = MONTH_INDEX[monthFirst[1]];
        if (month === undefined) return null;

        const firstNumber = monthFirst[2] ? Number(monthFirst[2]) : null;
        const hasExplicitYear = monthFirst[3] !== undefined;
        const firstNumberIsYear = !hasExplicitYear && firstNumber !== null && firstNumber > 31;
        const day = firstNumber === null || firstNumberIsYear ? 1 : firstNumber;
        const yearValue = hasExplicitYear
            ? monthFirst[3]
            : firstNumberIsYear
              ? firstNumber
              : fallbackYear;
        const year = normalizeYear(yearValue, fallbackYear);

        return createLocalDate(year, month, day);
    }

    /**
     * Search stories by title using string matching
     * @param {Array} allStories - Array of all stories
     * @param {string} searchText - Text to search for in story titles
     * @returns {Array} - Stories with titles containing the search text
     */
    static searchStoriesByTitle(allStories, searchText) {
        if (!searchText || !Array.isArray(allStories)) return [];

        const searchTerm = searchText.toString().trim().toLowerCase();
        if (!searchTerm) return [];

        return allStories.filter((story) => {
            if (story.title && typeof story.title === 'string') {
                return story.title.toLowerCase().includes(searchTerm);
            }
            return false;
        });
    }

    /**
     * Search stories by date matching (exact, exact-7days, or range)
     * @param {Array} allStories - Array of all stories
     * @param {string} startDate - Start date in YYYY-MM-DD format (optional)
     * @param {string} endDate - End date in YYYY-MM-DD format (optional)
     * @param {string} searchMode - 'exact', 'exact-7days', or 'range' (default: 'exact')
     * @returns {Array} - Stories matching the date criteria
     */
    static searchStoriesByDateRange(allStories, startDate, endDate, searchMode = 'exact') {
        if (!startDate && !endDate) return [];

        return allStories.filter((story) => {
            // Convert story dates to YYYY-MM-DD format for simple string comparison
            const storyStartDateStr = this.convertStoryDateToISO(
                story.startDate || story.startMonth || '',
                story.roadmapYear
            );
            const storyEndDateStr = this.convertStoryDateToISO(
                story.endDate || story.endMonth || '',
                story.roadmapYear
            );

            // Validate: Skip stories where end date is before start date (invalid data)
            if (storyStartDateStr && storyEndDateStr && storyEndDateStr < storyStartDateStr) {
                return false;
            }

            if (searchMode === 'exact') {
                // EXACT MATCH MODE
                if (startDate && endDate) {
                    // Story must start on startDate AND end on endDate
                    return storyStartDateStr === startDate && storyEndDateStr === endDate;
                } else if (startDate) {
                    // Story must start exactly on this date
                    return storyStartDateStr === startDate;
                } else if (endDate) {
                    // Story must end exactly on this date
                    return storyEndDateStr === endDate;
                }
            } else if (searchMode === 'exact-7days') {
                // EXACT +/- 7 DAYS MODE
                if (startDate && endDate) {
                    // Story must start within startDate to startDate+7 days AND end within endDate +/- 7 days
                    const startMatches =
                        storyStartDateStr &&
                        this.isStartDateWithin7DaysForward(storyStartDateStr, startDate);
                    const endMatches =
                        storyEndDateStr && this.isWithinDateRange(storyEndDateStr, endDate, 7, 7); // +/- 7 days
                    return startMatches && endMatches;
                } else if (startDate) {
                    // Story must start within startDate to startDate+7 days (FORWARD ONLY)
                    return (
                        storyStartDateStr &&
                        this.isStartDateWithin7DaysForward(storyStartDateStr, startDate)
                    );
                } else if (endDate) {
                    // Story must end within endDate +/- 7 days
                    return (
                        storyEndDateStr && this.isWithinDateRange(storyEndDateStr, endDate, 7, 7)
                    );
                }
            } else {
                // RANGE SEARCH MODE (also used for current-year)
                if (startDate && endDate) {
                    // Story must start on or after startDate AND end on or before endDate
                    if (storyStartDateStr && storyEndDateStr) {
                        return storyStartDateStr >= startDate && storyEndDateStr <= endDate;
                    } else if (storyStartDateStr) {
                        // Only story start date available - must start on or after start date
                        return storyStartDateStr >= startDate;
                    } else if (storyEndDateStr) {
                        // Only story end date available - must end on or before end date
                        return storyEndDateStr <= endDate;
                    }
                } else if (startDate) {
                    // Story must start on or after this date
                    return storyStartDateStr && storyStartDateStr >= startDate;
                } else if (endDate) {
                    // Story must end on or before this date
                    return storyEndDateStr && storyEndDateStr <= endDate;
                }
            }

            return false;
        });
    }

    /**
     * Convert story date to ISO format (YYYY-MM-DD) for simple string comparison
     * @param {string} dateStr - Story date string (various formats)
     * @param {number} defaultYear - Default year to use if not specified
     * @returns {string|null} - ISO date string or null if parsing fails
     */
    static convertStoryDateToISO(dateStr, defaultYear) {
        const date = this.parseStoryDate(dateStr, defaultYear);
        if (!date) return null;

        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    }

    /**
     * Check if a story start date is within 7 days forward from target date (NEVER backward)
     * @param {string} storyDateStr - Story date in YYYY-MM-DD format
     * @param {string} targetStartDate - Target start date in YYYY-MM-DD format
     * @returns {boolean} - True if story date is between targetStartDate and targetStartDate+7 days
     */
    static isStartDateWithin7DaysForward(storyDateStr, targetStartDate) {
        if (!storyDateStr || !targetStartDate) return false;

        const storyDate = new Date(storyDateStr);
        const targetDate = new Date(targetStartDate);

        // Calculate 7 days forward from target date
        const rangeEnd = new Date(targetDate);
        rangeEnd.setDate(targetDate.getDate() + 7);

        // Story date must be >= target date AND <= target date + 7 days
        // This ensures we never go backward from the target date
        return storyDate >= targetDate && storyDate <= rangeEnd;
    }

    /**
     * Check if a story date is within a range of days from a target date
     * @param {string} storyDateStr - Story date in YYYY-MM-DD format
     * @param {string} targetDateStr - Target date in YYYY-MM-DD format
     * @param {number} daysBefore - Number of days before target date
     * @param {number} daysAfter - Number of days after target date
     * @returns {boolean} - True if story date is within the range
     */
    static isWithinDateRange(storyDateStr, targetDateStr, daysBefore, daysAfter) {
        if (!storyDateStr || !targetDateStr) return false;

        const storyDate = new Date(storyDateStr);
        const targetDate = new Date(targetDateStr);

        // Calculate the range boundaries
        const rangeStart = new Date(targetDate);
        rangeStart.setDate(targetDate.getDate() - daysBefore);

        const rangeEnd = new Date(targetDate);
        rangeEnd.setDate(targetDate.getDate() + daysAfter);

        return storyDate >= rangeStart && storyDate <= rangeEnd;
    }

    /**
     * Get story status display information
     * @param {Object} story - Story object
     * @returns {Object} - {text: string, className: string, icon: string}
     */
    static getStoryStatus(story) {
        if (story.isDone) {
            return { text: 'Done', className: 'status-done', icon: '✅' };
        }
        if (story.isCancelled) {
            return { text: 'Cancelled', className: 'status-cancelled', icon: '❌' };
        }
        if (story.isAtRisk) {
            return { text: 'At Risk', className: 'status-at-risk', icon: '⚠️' };
        }
        if (story.isNewStory) {
            return { text: 'New', className: 'status-new', icon: '🆕' };
        }
        if (story.isProposed) {
            return { text: 'Proposed', className: 'status-proposed', icon: '💡' };
        }

        return { text: 'In Progress', className: 'status-in-progress', icon: '🔄' };
    }
}
