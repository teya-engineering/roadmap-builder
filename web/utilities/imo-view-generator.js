import { RoadmapGenerator } from '../roadmap-generator.js';
import { IMOUtility } from './imo-utility.js';
import { UIUtility } from './ui-utility.js';
import { orderTeamNames } from '../domain/team-order.js';

export class IMOViewGenerator {
    
    /**
     * Generate complete search results HTML
     * @param {Array} stories - Filtered stories from IMOUtility.searchStories()
     * @param {string} searchQuery - Original search query
     * @returns {string} - Complete HTML for search results
     */
    static generateSearchResults(stories, searchQuery) {
        if (!Array.isArray(stories) || stories.length === 0) {
            return this.generateNoResultsMessage(searchQuery);
        }
        
        const resultCount = stories.length;
        const teamsCount = new Set(stories.map(s => s.teamName)).size;
        
        return `
            <div class="imo-search-results">
                <div class="search-results-header">
                    <h2>Search Results</h2>
                    <div class="search-summary">
                        Found <strong>${resultCount}</strong> ${resultCount === 1 ? 'story' : 'stories'} 
                        across <strong>${teamsCount}</strong> ${teamsCount === 1 ? 'team' : 'teams'} 
                        for "<strong>${this.escapeHtml(searchQuery)}</strong>"
                    </div>
                    <div class="search-results-controls" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                        <label style="display: flex; align-items: center; gap: 5px; font-weight: normal; font-size: 14px;">
                            <input type="checkbox" id="search-force-text-below-toggle" onchange="handleSearchForceTextBelowToggle()">
                            Force all text boxes below stories
                        </label>
                    </div>
                </div>
                
                <div class="search-results-content">
                    ${this.generateResultsByTeam(stories)}
                </div>
                
                <div class="search-results-footer">
                    <button onclick="clearSearchResults()" class="secondary">
                        ← Back to Search
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Generate results grouped by team
     * @param {Array} stories - Array of story objects
     * @returns {string} - HTML for team-grouped results
     */
    static generateResultsByTeam(stories) {
        // Group stories by team
        const teamGroups = this.groupStoriesByTeam(stories);
        
        let html = '';
        
        Object.keys(teamGroups).sort().forEach(teamName => {
            const teamStories = teamGroups[teamName];
            html += this.generateTeamSection(teamName, teamStories);
        });
        
        return html;
    }
    
    /**
     * Group stories by team name
     * @param {Array} stories - Array of story objects  
     * @returns {Object} - Object with teamName as keys, arrays of stories as values
     */
    static groupStoriesByTeam(stories) {
        const groups = {};
        
        stories.forEach(story => {
            const teamName = story.teamName || 'Unknown Team';
            if (!groups[teamName]) {
                groups[teamName] = [];
            }
            groups[teamName].push(story);
        });
        
        return groups;
    }
    
    /**
     * Generate HTML for a team section with its stories
     * @param {string} teamName - Name of the team
     * @param {Array} stories - Stories for this team
     * @returns {string} - HTML for team section
     */
    static generateTeamSection(teamName, stories) {
        const storyCards = stories.map(story => this.generateStoryCard(story)).join('');
        
        return `
            <div class="team-section">
                <div class="team-header">
                    <h3>📋 ${this.escapeHtml(teamName)}</h3>
                    <span class="story-count">${stories.length} ${stories.length === 1 ? 'story' : 'stories'}</span>
                </div>
                <div class="team-stories">
                    ${storyCards}
                </div>
            </div>
        `;
    }
    
    /**
     * Generate HTML card for a single story
     * @param {Object} story - Story object with team context
     * @returns {string} - HTML for story card
     */
    static generateStoryCard(story) {
        const status = IMOUtility.getStoryStatus(story);
        const timeline = this.formatTimeline(story);
        const bullets = this.formatBullets(story.bullets);
        
        // Prepare story data for modal (escape for JSON)
        const storyDataJson = JSON.stringify(story).replace(/"/g, '&quot;');
        
        return `
            <div class="story-card" data-story-id="${story.id || ''}" data-team="${this.escapeHtml(story.teamName)}" 
                 data-story-json="${storyDataJson}"
                 ondblclick="handleStoryCardDoubleClickDirect(this)" 
                 title="Double-click to view story details">
                <div class="story-card-header">
                    <div class="story-title">
                        <strong>${this.escapeHtml(story.title)}</strong>
                        ${story.imo ? `<span class="imo-tag">${this.escapeHtml(story.imo)}</span>` : ''}
                    </div>
                    <div class="story-status">
                        <span class="status-badge ${status.className}">
                            ${status.icon} ${status.text}
                        </span>
                    </div>
                </div>
                
                <div class="story-card-details">
                    <div class="story-meta">
                        <span class="epic-name">Epic: ${this.escapeHtml(story.epicName || 'N/A')}</span>
                        ${timeline ? `<span class="timeline">${timeline}</span>` : ''}
                    </div>
                    
                    ${bullets ? `<div class="story-bullets">${bullets}</div>` : ''}
                </div>
                
                <div class="story-card-actions">
                    <button onclick="openOriginalRoadmap('${this.escapeHtml(story.sourceFile)}', '${story.id || story.title}')" 
                            class="action-button" title="Open in original roadmap">
                        📂 Open Roadmap
                    </button>
                    <button onclick="handleStoryCardDoubleClickDirect(this.closest('.story-card'))" 
                            class="action-button" title="View story details">
                        👁️ View Details
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Format timeline information for display
     * @param {Object} story - Story object
     * @returns {string} - Formatted timeline string
     */
    static formatTimeline(story) {
        const start = story.startDate || story.startMonth || '';
        const end = story.endDate || story.endMonth || '';
        
        if (!start && !end) return '';
        
        if (start && end) {
            return `📅 ${start} - ${end}`;
        } else if (end) {
            return `📅 Ends: ${end}`;
        } else if (start) {
            return `📅 Starts: ${start}`;
        }
        
        return '';
    }
    
    /**
     * Format bullet points for display using UIUtility for consistency
     * @param {Array|string} bullets - Bullet points array or string
     * @returns {string} - HTML for bullet points
     */
    static formatBullets(bullets) {
        if (!bullets) return '';
        
        let bulletArray = [];
        if (Array.isArray(bullets)) {
            bulletArray = bullets;
        } else if (typeof bullets === 'string') {
            bulletArray = bullets.split('\n').filter(line => line.trim());
        }
        
        if (bulletArray.length === 0) return '';
        
        // Use UIUtility for consistent bullet formatting like the main roadmap
        // For search results, show max 3 bullets and add "more" indicator if needed
        const displayBullets = bulletArray.slice(0, 3);
        const moreCount = bulletArray.length - 3;
        
        if (moreCount > 0) {
            displayBullets.push(`+ ${moreCount} more...`);
        }
        
        const tempGenerator = new RoadmapGenerator(2025);
        return UIUtility.generateBulletsHTML(displayBullets, (text) => tempGenerator.formatText(text));
    }

    /**
     * Generate no results message
     * @param {string} searchQuery - The search query that returned no results
     * @returns {string} - HTML for no results message
     */
    static generateNoResultsMessage(searchQuery) {
        return `
            <div class="no-results">
                <div class="no-results-icon">🔍</div>
                <h3>No Stories Found</h3>
                <p>No stories match the search: <strong>"${this.escapeHtml(searchQuery)}"</strong></p>
                <div class="search-suggestions">
                    <h4>Try searching for:</h4>
                    <ul>
                        <li><strong>CP numbers:</strong> "CP 0043" or "0043"</li>
                        <li><strong>Quarters:</strong> "Q1", "Q2", "Q3", "Q4"</li>
                        <li><strong>Months:</strong> "April", "Mar", "September"</li>
                        <li><strong>Years:</strong> "2025", "2024"</li>
                    </ul>
                </div>
                <button onclick="clearSearchResults()" class="primary">
                    Try Another Search
                </button>
            </div>
        `;
    }
    
    /**
     * Generate CSS styles for the search results
     * @returns {string} - CSS stylesheet for IMO search results
     */
    static generateCSS() {
        return `
            <style>
                .imo-search-results {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 20px;
                    font-family: Arial, sans-serif;
                }
                
                .search-results-header {
                    margin-bottom: 30px;
                    border-bottom: 2px solid #007cba;
                    padding-bottom: 15px;
                }
                
                .search-results-header h2 {
                    margin: 0 0 10px 0;
                    color: #007cba;
                }
                
                .search-summary {
                    color: #666;
                    font-size: 14px;
                }
                
                .team-section {
                    margin-bottom: 30px;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    overflow: hidden;
                }
                
                .team-header {
                    background: #f8f9fa;
                    padding: 15px 20px;
                    border-bottom: 1px solid #ddd;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .team-header h3 {
                    margin: 0;
                    color: #333;
                }
                
                .story-count {
                    background: #007cba;
                    color: white;
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: bold;
                }
                
                .team-stories {
                    padding: 0;
                }
                
                .story-card {
                    border-bottom: 1px solid #eee;
                    padding: 20px;
                    transition: background-color 0.2s;
                }
                
                .story-card:hover {
                    background-color: #f8f9fa;
                }
                
                .story-card:last-child {
                    border-bottom: none;
                }
                
                .story-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 10px;
                }
                
                .story-title {
                    flex: 1;
                    margin-right: 15px;
                }
                
                .story-title strong {
                    font-size: 16px;
                    color: #333;
                }
                
                .imo-tag {
                    background: #e3f2fd;
                    color: #1976d2;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                    margin-left: 8px;
                }
                
                .status-badge {
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: bold;
                    white-space: nowrap;
                }
                
                .status-done { background: #d4edda; color: #155724; }
                .status-cancelled { background: #f8d7da; color: #721c24; }
                .status-at-risk { background: #fff3cd; color: #856404; }
                .status-new { background: #cce5ff; color: #004085; }
                .status-proposed { background: #e2e3e5; color: #383d41; }
                .status-in-progress { background: #e7f3ff; color: #0056b3; }
                
                .story-meta {
                    margin-bottom: 10px;
                    font-size: 13px;
                    color: #666;
                }
                
                .story-meta span {
                    margin-right: 15px;
                }
                
                .story-bullets .task-bullets {
                    /* Use same spacing as main roadmap for consistency */
                    font-size: 9pt;
                    margin: 0;
                    padding-left: 12px;
                    list-style-type: square;
                    color: #555;
                }
                
                .story-bullets .task-bullets li {
                    margin: 0;
                }
                
                .story-bullets .task-bullets li:not(:last-child) {
                    margin-bottom: 3px;
                }
                
                .more-bullets {
                    color: #888;
                    font-style: italic;
                }
                
                .story-card-actions {
                    margin-top: 15px;
                    text-align: right;
                }
                
                .action-button {
                    background: #007cba;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background-color 0.2s;
                }
                
                .action-button:hover {
                    background: #0056b3;
                }
                
                .no-results {
                    text-align: center;
                    padding: 60px 20px;
                    color: #666;
                }
                
                .no-results-icon {
                    font-size: 48px;
                    margin-bottom: 20px;
                }
                
                .no-results h3 {
                    margin: 0 0 15px 0;
                    color: #333;
                }
                
                .search-suggestions {
                    background: #f8f9fa;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 30px 0;
                    text-align: left;
                    max-width: 400px;
                    margin-left: auto;
                    margin-right: auto;
                }
                
                .search-suggestions h4 {
                    margin: 0 0 10px 0;
                    color: #333;
                }
                
                .search-suggestions ul {
                    margin: 0;
                    padding-left: 20px;
                }
                
                .search-suggestions li {
                    margin: 5px 0;
                    font-size: 14px;
                }
                
                .search-results-footer {
                    margin-top: 30px;
                    text-align: center;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                }
                
                .primary, .secondary {
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    border: none;
                    transition: background-color 0.2s;
                }
                
                .primary {
                    background: #007cba;
                    color: white;
                }
                
                .primary:hover {
                    background: #0056b3;
                }
                
                .secondary {
                    background: #6c757d;
                    color: white;
                }
                
                .secondary:hover {
                    background: #5a6268;
                }
            </style>
        `;
    }
    
    /**
     * Utility function to escape HTML
     * @param {string} text - Text to escape
     * @returns {string} - HTML-escaped text
     */
    static escapeHtml(text) {
        if (!text || typeof text !== 'string') return '';
        
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    
    /**
     * Generate iframe-based results page for better border isolation
     * @param {Array} stories - Search results
     * @param {string} searchQuery - Original search query
     * @returns {string} - Complete HTML page with iframe
     */
    static generateIframeResultsPage(stories, searchQuery) {
        // Transform stories into roadmap format
        const crossTeamData = this.transformStoriesToRoadmapData(stories, searchQuery);
        
        // Generate the roadmap content for iframe
        const roadmapContent = this.generateRoadmapContentForIframe(crossTeamData);
        
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CP Search: ${this.escapeHtml(searchQuery)} - Cross-Team Results</title>
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: Arial, sans-serif;
                        background: #f8f9fa;
                    }
                    
                    .search-header {
                        background: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        border-left: 4px solid #007cba;
                    }
                    
                    .search-header h1 {
                        margin: 0 0 10px 0;
                        color: #007cba;
                        font-size: 24px;
                    }
                    
                    .search-info {
                        color: #666;
                        font-size: 14px;
                        margin: 5px 0;
                    }
                    
                    .back-button {
                        background: #6c757d;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        margin-top: 15px;
                    }
                    
                    .back-button:hover {
                        background: #5a6268;
                    }
                    
                    .roadmap-iframe {
                        width: 100%;
                        height: 80vh;
                        border: none;
                        border-radius: 8px;
                        background: white;
                    }
                </style>
            </head>
            <body>
                <div class="search-header">
                    <h1>🔍 Cross-Team Search Results</h1>
                    <div class="search-info">
                        <strong>Search Query:</strong> "${this.escapeHtml(searchQuery)}"
                    </div>
                    <div class="search-info">
                        <strong>Stories Found:</strong> ${crossTeamData.epics.length}
                    </div>
                    <div class="search-info">
                        <strong>Teams:</strong> ${new Set(crossTeamData.epics.map(epic => epic.name)).size}
                    </div>
                    <button class="back-button" onclick="goBack()">← Back to Search</button>
                </div>
                
                <iframe class="roadmap-iframe" srcdoc="${this.escapeHtml(roadmapContent)}"></iframe>
                
                <script>
                    function goBack() {
                        if (window.opener) {
                            window.close();
                        } else {
                            window.history.back();
                        }
                    }
                </script>
            </body>
            </html>
        `;
    }
    
    /**
     * Generate roadmap content for iframe (cleaner isolation)
     * @param {Object} crossTeamData - Transformed team data for roadmap
     * @returns {string} - Clean roadmap HTML for iframe
     */
    static generateRoadmapContentForIframe(crossTeamData) {
        // Use RoadmapGenerator to create clean roadmap content
        const generator = new RoadmapGenerator(crossTeamData.roadmapYear);
        const roadmapHtml = generator.generateRoadmap(crossTeamData, false, false); // full HTML for iframe with editing disabled
        
        // Smart cleaning: Keep only swimlanes that have actual story content
        const swimlaneMatches = roadmapHtml.match(/<div class="swimlane"[^>]*>[\s\S]*?<\/div>/g);
        const storyContentRegex = /<div class="story"[^>]*>/;
        
        let cleanedHtml = roadmapHtml;
        
        // Remove obvious separators first
        cleanedHtml = cleanedHtml
            .replace(/<div class="swimlane-separator-dashed"><\/div>/g, '')
            .replace(/<div class="swimlane-separator"><\/div>/g, '')
            .replace(/Below the Line/g, '');
        
        // Keep only swimlanes that have actual story content
        if (swimlaneMatches) {
            swimlaneMatches.forEach(swimlane => {
                const hasStoryContent = storyContentRegex.test(swimlane);
                
                if (!hasStoryContent) {
                    cleanedHtml = cleanedHtml.replace(swimlane, '');
                }
            });
        }
        
        // Add CSS fix for unnecessary ellipsis on team names and minimum swimlane height
        const cssOverride = `
            <style>
                /* Fix text truncation on epic labels with higher specificity */
                .roadmap-container .swimlanes-container .swimlane .epic-label {
                    text-overflow: none;
                    overflow: visible;
                    white-space: nowrap;
                    max-width: none;
                    width: 200px;
                    height: 200px;
                    top: 0;
                    bottom: auto;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                /* Set reasonable minimum height for all swimlanes */
                .roadmap-container .swimlanes-container .swimlane {
                    min-height: 80px;
                }
                
                /* Make swimlane content fill the swimlane height */
                .roadmap-container .swimlanes-container .swimlane .swimlane-content {
                    min-height: 80px;
                }
                
                /* Special swimlanes (KTLO) also get minimum height */
                .roadmap-container .swimlanes-container .special-swimlane {
                    min-height: 80px;
                }
                
                .roadmap-container .swimlanes-container .special-swimlane .swimlane-content {
                    min-height: 80px;
                }
                
                /* Remove all spacing and hide empty swimlanes */
                .swimlane-separator { 
                    display: none; 
                }
                .swimlanes-container > * {
                    margin: 0;
                    padding: 0;
                }
                .roadmap-container {
                    margin: 0;
                    padding: 0;
                }
                .swimlane {
                    margin: 0;
                    padding: 0;
                    border: none;
                }
                .swimlanes-container {
                    gap: 0;
                    margin: 0;
                    padding: 0;
                }
                /* Hide any empty swimlanes that might remain */
                .swimlane:empty {
                    display: none;
                }
                .swimlane-content:empty {
                    display: none;
                }
                
                /* Ensure epic labels are visible and properly positioned */
                .epic-label {
                    display: flex;
                    opacity: 1;
                    visibility: visible;
                    color: #333;
                    font-weight: 900;
                    font-size: 18px;
                }
            </style>
        `;
        
        // Insert CSS override before closing head tag or at the beginning
        if (cleanedHtml.includes('</head>')) {
            cleanedHtml = cleanedHtml.replace('</head>', cssOverride + '</head>');
        } else {
            cleanedHtml = cssOverride + cleanedHtml;
        }
        
        return cleanedHtml;
    }
    
    /**
     * Generate complete HTML page with all required dependencies
     * @param {Object} crossTeamData - Transformed team data for roadmap
     * @param {string} searchQuery - Original search query
     * @returns {string} - Complete HTML with all scripts and styles
     */
    static generateRoadmapPageWithDependencies(crossTeamData, searchQuery) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CP Search: ${this.escapeHtml(searchQuery)} - Cross-Team Results</title>
                
                <!-- Include all required dependencies -->
                <script src="./utilities/date-utility.js"></script>
                <script src="./utilities/ui-utility.js"></script>
                <script src="./utilities/config-utility.js"></script>
                <script src="./roadmap-generator.js"></script>
                
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: Arial, sans-serif;
                        background: #f8f9fa;
                    }
                    
                    .search-header {
                        background: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        border-left: 4px solid #007cba;
                    }
                    
                    .search-header h1 {
                        margin: 0 0 10px 0;
                        color: #007cba;
                        font-size: 24px;
                    }
                    
                    .search-info {
                        color: #666;
                        font-size: 14px;
                        margin: 5px 0;
                    }
                    
                    .back-button {
                        background: #6c757d;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        margin-top: 15px;
                    }
                    
                    .back-button:hover {
                        background: #5a6268;
                    }
                    
                    .roadmap-container {
                        background: transparent;
                    }
                </style>
            </head>
            <body>
                <div class="search-header">
                    <h1>🔍 Cross-Team Search Results</h1>
                    <div class="search-info">
                        <strong>Search Query:</strong> "${this.escapeHtml(searchQuery)}"
                    </div>
                    <div class="search-info">
                        <strong>Stories Found:</strong> ${crossTeamData.epics.length}
                    </div>
                    <div class="search-info">
                        <strong>Teams:</strong> ${new Set(crossTeamData.epics.map(epic => epic.name.split(' - ')[0])).size}
                    </div>
                    <button class="back-button" onclick="goBack()">← Back to Search</button>
                </div>
                
                <div class="roadmap-container" id="roadmapContainer">
                    <!-- Roadmap will be generated here -->
                </div>
                
                <script>
                    function initializeRoadmap() {
                        // Check if roadmapContainer exists
                        const container = document.getElementById('roadmapContainer');
                        
                        if (!container) {
                            console.error('roadmapContainer element not found!');
                            return;
                        }
                        
                        // Check if RoadmapGenerator is available
                        if (typeof RoadmapGenerator === 'undefined') {
                            console.error('RoadmapGenerator not available');
                            container.innerHTML = 
                                '<div style="padding: 40px; text-align: center; color: #999;">Error loading roadmap generator. Please refresh the page.</div>';
                            return;
                        }
                        
                        // Cross-team data
                        const crossTeamData = ${JSON.stringify(crossTeamData)};
                        
                        try {
                            // Validate data structure
                            if (!crossTeamData.epics || !Array.isArray(crossTeamData.epics)) {
                                throw new Error('Invalid epics data structure');
                            }
                            
                            if (crossTeamData.epics.length === 0) {
                                container.innerHTML = '<div style="padding: 40px; text-align: center; color: #999;">No matching stories found for this search.</div>';
                                return;
                            }
                            
                            // Generate roadmap using the same generator
                            const generator = new RoadmapGenerator(crossTeamData.roadmapYear);
                            const roadmapHtml = generator.generateRoadmap(crossTeamData, true, false); // embedded=true with editing disabled 
                            
                            // Remove BTL-related elements since we don't want them in IMO search results
                            const dashedSeparatorRegex = new RegExp('<div class="swimlane-separator-dashed"></div>', 'g');
                            let cleanedHtml = roadmapHtml;
                            
                            // Remove dashed separator
                            cleanedHtml = cleanedHtml.replace(dashedSeparatorRegex, '');
                            
                            // Remove ALL BTL-related content since RoadmapGenerator always adds it
                            
                            // Remove BTL epic swimlanes (the "Below the Line" epic section)
                            const btlEpicRegex = new RegExp('<div class="epic-swimlane[^>]*>[\\s\\S]*?Below the Line[\\s\\S]*?</div>', 'g');
                            cleanedHtml = cleanedHtml.replace(btlEpicRegex, '');
                            
                            // Remove any BTL swimlane content (the actual BTL section at bottom)
                            const btlSwimlaneRegex = new RegExp('<div class="btl-swimlane[^>]*>[\\s\\S]*?</div>', 'g');
                            cleanedHtml = cleanedHtml.replace(btlSwimlaneRegex, '');
                            
                            // Remove any remaining "Below the Line" text
                            cleanedHtml = cleanedHtml.replace(/Below the Line/g, '');
                            
                            // Remove BTL related elements by class
                            cleanedHtml = cleanedHtml.replace(/<div[^>]*class="[^"]*btl[^"]*"[^>]*>[\\s\\S]*?<\\/div>/g, '');
                            
                            // embedded=true returns: <div class="roadmap-wrapper">{CSS}{content}</div>
                            container.innerHTML = cleanedHtml;
                            
                        } catch (error) {
                            console.error('Error generating roadmap:', error);
                            container.innerHTML = 
                                '<div style="padding: 40px; text-align: center; color: #999;">Error generating roadmap view: ' + error.message + '</div>';
                        }
                    }
                    
                    // Try multiple approaches to ensure DOM is ready
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initializeRoadmap);
                    } else {
                        // DOM is already ready
                        initializeRoadmap();
                    }
                    
                    // Fallback - also try after a short delay
                    setTimeout(initializeRoadmap, 100);
                    
                    function goBack() {
                        if (window.opener) {
                            window.close();
                        } else {
                            window.history.back();
                        }
                    }
                </script>
            </body>
            </html>
        `;
    }
    
    /**
     * Normalize date for consistent roadmap positioning
     * @param {string} dateStr - Date string (e.g. "01/01/25")
     * @param {string} monthStr - Month string (e.g. "JAN")
     * @returns {Object} - {dateStr, monthStr} normalized for positioning
     */
    static normalizeDate(dateStr, monthStr) {
        // If already has month string, use it
        if (monthStr && monthStr.trim()) {
            return { dateStr: '', monthStr: String(monthStr.trim()) };
        }
        
        // If no date string, return empty
        if (!dateStr || !dateStr.trim()) {
            return { dateStr: '', monthStr: '' };
        }
        
        try {
            // Try to parse the date
            const parsed = IMOUtility.parseStoryDate(dateStr, new Date().getFullYear());
            if (parsed && parsed.getDate() === 1) {
                // Only convert to month name if the original was JUST a month (not a specific date)
                // Check if original dateStr looks like a specific date (contains day/month/year pattern)
                const isSpecificDate = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(dateStr.trim());
                
                if (!isSpecificDate) {
                    // Original was just a month name - convert to month name for consistent positioning
                    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                                      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                    const monthName = monthNames[parsed.getMonth()];
                    return { dateStr: '', monthStr: monthName };
                }
                // If it was a specific date, preserve it as a date
            }
        } catch {
            // If parsing fails, use original date
        }
        
        // Use original date string (trimmed)
        return { dateStr: String(dateStr.trim()), monthStr: '' };
    }

    /**
     * Transform search results into roadmap data structure with each story as its own epic/swimlane
     * @param {Array} stories - Search results from IMO search
     * @param {string} searchQuery - Original search query
     * @param {Object} searchRange - Optional search range with startDate and endDate for date range searches
     * @param {string[]} teamOrder - Saved team order; teams not in it follow A-Z
     * @returns {Object} - TeamData object compatible with RoadmapGenerator
     */
    static transformStoriesToRoadmapData(stories, searchQuery, searchRange = null, teamOrder = []) {
        // Filter out any invalid stories first
        const validStories = stories.filter(story => {
            if (!story || typeof story !== 'object') {
                console.warn('Invalid story object:', story);
                return false;
            }
            if (!story.title || typeof story.title !== 'string') {
                console.warn('Story missing title:', story);
                return false;
            }
            if (!story.teamName || typeof story.teamName !== 'string') {
                console.warn('Story missing teamName:', story);
                return false;
            }
            return true;
        });
        
        if (validStories.length === 0) {
            console.error('No valid stories to transform');
            // Return minimal valid structure
            return {
                teamName: `Cross-Team Search Results`,
                roadmapYear: new Date().getFullYear(),
                em: '',
                pm: '',
                description: `No valid stories found for "${searchQuery}"`,
                epics: []
                // Completely exclude KTLO and BTL to prevent their generation
                // Don't include ktloSwimlane or btlSwimlane at all
            };
        }
        
        // Group stories by team (multiple stories from same team go in same swimlane)
        const teamGroups = {};
        
        validStories.forEach(story => {
            const teamName = story.teamName || 'Unknown Team';
            
            if (!teamGroups[teamName]) {
                teamGroups[teamName] = [];
            }
            
            const processedBullets = Array.isArray(story.bullets) ? story.bullets : 
                                   (typeof story.bullets === 'string' ? story.bullets.split('\n').filter(b => b.trim()) : []);
            
            // Normalize dates for consistent positioning
            const normalizedStartDate = this.normalizeDate(story.startDate, story.startMonth);
            const normalizedEndDate = this.normalizeDate(story.endDate, story.endMonth);
            
            teamGroups[teamName].push({
                title: String(story.title || 'Untitled Story'),
                startDate: normalizedStartDate.dateStr,
                startMonth: normalizedStartDate.monthStr,
                endDate: normalizedEndDate.dateStr,
                endMonth: normalizedEndDate.monthStr,
                bullets: processedBullets,
                imo: String(story.imo || ''),
                priority: String(story.priority || ''),
                fte: story.fte,
                countryFlags: Array.isArray(story.countryFlags) ? story.countryFlags : [],
                isDone: Boolean(story.isDone),
                isCancelled: Boolean(story.isCancelled),
                isAtRisk: Boolean(story.isAtRisk),
                isNewStory: Boolean(story.isNewStory),
                isInfo: Boolean(story.isInfo),
                isTransferredOut: Boolean(story.isTransferredOut),
                isTransferredIn: Boolean(story.isTransferredIn),
                isProposed: Boolean(story.isProposed),
                // Include roadmap changes data for text boxes
                roadmapChanges: story.roadmapChanges || [],
                doneInfo: story.doneInfo || null,
                cancelInfo: story.cancelInfo || null,
                atRiskInfo: story.atRiskInfo || null,
                newStoryInfo: story.newStoryInfo || null,
                infoInfo: story.infoInfo || null,
                transferredOutInfo: story.transferredOutInfo || null,
                transferredInInfo: story.transferredInInfo || null,
                proposedInfo: story.proposedInfo || null,
                // Add source information for reference
                _originalEpic: String(story.epicName || 'Unknown Epic'),
                _sourceTeam: String(story.teamName || 'Unknown Team'),
                _sourceFile: String(story.sourceFile || 'Unknown File')
            });
        });
        
        // Convert team groups to epics (one epic per team) in the user's saved order
        const epics = orderTeamNames(Object.keys(teamGroups), teamOrder).map(teamName => {
            return {
                name: teamName,
                stories: teamGroups[teamName]
            };
        });
        
        const roadmapYear =
            Number(validStories.find((story) => story.roadmapYear)?.roadmapYear) ||
            new Date().getFullYear();
        
        // Create team data structure compatible with RoadmapGenerator
        return {
            teamName: `Cross-Team Search Results`,
            roadmapYear: roadmapYear,
            em: '',
            pm: '',
            description: '', // Remove description to avoid duplicate search results info
            epics: epics,
            // Provide empty BTL data to prevent automatic generation
            btlSwimlane: { stories: [] },
            // Don't include ktloSwimlane to prevent KTLO generation
            // Add search range information for date range searches
            searchRange: searchRange
        };
    }
}
