import { RoadmapGenerator } from '../../roadmap-generator.js';
import { IMOUtility } from '../../utilities/imo-utility.js';
import { IMOViewGenerator } from '../../utilities/imo-view-generator.js';
import { ConfigUtility } from '../../utilities/config-utility.js';
import { moveTeam, mergeTeamOrder } from '../../domain/team-order.js';
import { renderCountryFlagsHTML } from '../../utilities/countries.js';
import { directoryStore } from '../../app/directory-store.js';

// Inline event attributes in the search view resolve their handlers against
// window, so init exposes those handlers after the view mounts.

/**
 * Mount this view. Called by the SPA router on every navigation here.
 *
 * @param {HTMLElement} _root - The container element (currently unused;
 *                              legacy code reaches DOM via document.* directly)
 */
export function init(_root) {
    const __viewReady = [];
    const __origAdd = document.addEventListener.bind(document);
    let cleanupDirectorySubscription = () => {};
    let closeTeamOrderPopover = () => {};
    document.addEventListener = function (type, listener, opts) {
        if (type === 'DOMContentLoaded') { __viewReady.push(listener); return; }
        return __origAdd(type, listener, opts);
    };
    try {
        // === BEGIN legacy script body ===

        // Global variables
        let selectedDirectory = null;
        let currentResults = [];
        let lastRoadmapFiles = [];
        
        // Get roadmap year from URL parameter (passed from Roadmap Builder)
        const urlParams = new URLSearchParams(window.location.search);
        const builderRoadmapYear = urlParams.get('year') ? parseInt(urlParams.get('year')) : null;
        
        // Track tri-state checkbox states: 'none', 'include', 'exclude'
        const statusFilterStates = {
            filterNew: 'none',
            filterDone: 'none',
            filterCancelled: 'none',
            filterAtRisk: 'none',
            filterTimeline: 'none',
            filterProposed: 'none',
            filterInfo: 'none',
            filterTransferredIn: 'none',
            filterTransferredOut: 'none'
        };
        
        // Search Stats Modal Functions
        function openSearchStatsModal() {
            try {
                if (!currentResults || currentResults.length === 0) {
                    alert('No search results to analyze. Please perform a search first.');
                    return;
                }
                
                const stats = computeSearchStats(currentResults);
                const body = document.getElementById('searchStatsModalBody');
                body.innerHTML = renderSearchStatsHtml(stats);
                const modal = document.getElementById('searchStatsModal');
                modal.style.display = 'flex';
                
                // Make stats available for interactive breakdown
                window.__searchStats = stats;
                
                // Add tooltip functionality after DOM is updated
                setTimeout(setupSearchTooltips, 100);
            } catch (e) {
                alert('Failed to compute stats: ' + e.message);
            }
        }
        
        function closeSearchStatsModal() {
            const modal = document.getElementById('searchStatsModal');
            if (modal) modal.style.display = 'none';
        }
        
        function computeSearchStats(stories) {
            const result = {
                totalStories: 0,
                totalTeams: 0,
                onTime: 0,
                onTimeDone: 0,
                onTimeNotDone: 0,
                delayedOnce: 0,
                delayedTwiceOrMore: 0,
                accelerated: 0,
                cancelled: 0,
                totalDelayed: 0,
                delayBreakdown: {},
                delayStories: {},
                acceleratedStories: { done: [], notDone: [] },
                onTimeStories: { done: [], notDone: [] },
                cancelledStories: [],
                teams: new Set()
            };
            
            if (!Array.isArray(stories)) return result;
            
            result.totalStories = stories.length;
            
            for (const story of stories) {
                // Track unique teams
                if (story.teamName) {
                    result.teams.add(story.teamName);
                }
                
                if (story.isCancelled) {
                    result.cancelled++;
                    result.cancelledStories.push({
                        title: story.title || 'Untitled',
                        teamName: story.teamName || 'Unknown Team',
                        epicName: story.epicName || ''
                    });
                    continue;
                }
                
                const changes = story.roadmapChanges?.changes || [];
                
                // Count only ACTUAL delays (new date > prev date)
                let actualDelayCount = 0;
                let hasAcceleration = false;
                
                if (Array.isArray(changes) && changes.length > 0) {
                    for (const change of changes) {
                        if (change.prevEndDate && change.newEndDate) {
                            // Parse dates properly using IMOUtility
                            const roadmapYear = story.roadmapYear || new Date().getFullYear();
                            const prevISO = IMOUtility.parseStoryDate(change.prevEndDate, roadmapYear);
                            const newISO = IMOUtility.parseStoryDate(change.newEndDate, roadmapYear);
                            
                            if (prevISO && newISO) {
                                // Compare ISO date strings
                                if (newISO > prevISO) {
                                    actualDelayCount++; // Actual delay
                                } else if (newISO < prevISO) {
                                    hasAcceleration = true; // Pulled forward
                                }
                            }
                        }
                    }
                }
                
                if (actualDelayCount === 0 && !hasAcceleration) {
                    // No timeline changes at all
                    result.onTime++;
                    const isDone = story.isDone || false;
                    if (isDone) {
                        result.onTimeDone++;
                        result.onTimeStories.done.push({ title: story.title || 'Untitled', teamName: story.teamName || 'Unknown Team' });
                    } else {
                        result.onTimeNotDone++;
                        result.onTimeStories.notDone.push({ title: story.title || 'Untitled', teamName: story.teamName || 'Unknown Team' });
                    }
                } else if (hasAcceleration && actualDelayCount === 0) {
                    // Only accelerations, no delays
                    result.accelerated++;
                    const acceleratedStory = { title: story.title || 'Untitled', teamName: story.teamName || 'Unknown Team' };
                    if (story.isDone) {
                        result.acceleratedStories.done.push(acceleratedStory);
                    } else {
                        result.acceleratedStories.notDone.push(acceleratedStory);
                    }
                } else if (actualDelayCount > 0) {
                    // Has at least one actual delay
                    result.totalDelayed++;
                    if (actualDelayCount === 1) {
                        result.delayedOnce++;
                    } else {
                        result.delayedTwiceOrMore++;
                    }
                    
                    // Track exact delay count for breakdown
                    result.delayBreakdown[actualDelayCount] = (result.delayBreakdown[actualDelayCount] || 0) + 1;
                    if (!result.delayStories[actualDelayCount]) {
                        result.delayStories[actualDelayCount] = { done: [], notDone: [] };
                    }
                    const delayedStory = {
                        title: story.title || 'Untitled',
                        teamName: story.teamName || 'Unknown Team'
                    };
                    if (story.isDone) {
                        result.delayStories[actualDelayCount].done.push(delayedStory);
                    } else {
                        result.delayStories[actualDelayCount].notDone.push(delayedStory);
                    }
                }
            }
            
            result.totalTeams = result.teams.size;
            return result;
        }
        
        function renderSearchStatsHtml(s) {
            return (
                '<div style="padding: 20px;">' +
                    '<h3 style="margin: 0 0 20px 0; color: var(--text-strong); text-align: center;">Search Results Overview</h3>' +
                    '<div style="margin-bottom: 20px; text-align: center; font-size: 14px; color: var(--text-muted);">' +
                        `${s.totalStories} Stories across ${s.totalTeams} Teams` +
                    '</div>' +
                    '<div style="max-width: 600px; margin: 0 auto;">' +
                        barChart('On-time Projects', s.onTime, s.totalStories, 'var(--stats-on-time)', s, 'ontime') +
                        barChart('Delayed Projects', s.totalDelayed, s.totalStories, 'var(--stats-delayed)', s, 'delayed') +
                        barChart('Accelerated Projects', s.accelerated, s.totalStories, 'var(--stats-accelerated)', s, 'accelerated') +
                        barChart('Cancelled', s.cancelled, s.totalStories, 'var(--stats-cancelled)', s, 'cancelled') +
                    '</div>' +
                '</div>'
            );
        }
        
        function barChart(label, value, total, color, stats, breakdownType) {
            const percentage = total ? ((value / total) * 100).toFixed(1) : 0;
            
            let tooltipContent = '';
            let expandIcon = '';
            let cursorStyle = 'default';
            if (stats && breakdownType) {
                tooltipContent = `data-tooltip="breakdown" data-breakdown-type="${breakdownType}"`;
                cursorStyle = 'pointer';
                // Add expand/collapse chevron icon on the LEFT
                expandIcon = `<span class="expand-chevron" style="margin-right: 8px; font-size: 12px; color: var(--text-muted); transition: transform 0.2s ease; pointer-events: none;">▶</span>`;
            }
            
            return (
                '<div style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: var(--surface-1); cursor: ' + cursorStyle + '; transition: all 0.2s ease;" class="bar-chart-container" ' + tooltipContent + '>' +
                    '<div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">' +
                        `<span style="font-size: 14px; font-weight: 500; color: var(--text-default); display: flex; align-items: center;">${expandIcon}${label}</span>` +
                        `<span style="font-size: 14px; font-weight: 600; color: ${color};">${value} (${percentage}%)</span>` +
                    '</div>' +
                '</div>'
            );
        }
        
        function getDelayBreakdown(stats) {
            let result = 'Delay Breakdown:\\n';
            
            const sortedDelays = Object.keys(stats.delayBreakdown || {})
                .map(Number)
                .sort((a, b) => a - b);
            
            if (sortedDelays.length === 0) {
                result += 'No delays recorded';
            } else {
                sortedDelays.forEach(delayCount => {
                    const count = stats.delayBreakdown[delayCount];
                    result += `${delayCount} delay${delayCount > 1 ? 's' : ''}: ${count}\\n`;
                });
            }
            
            return result;
        }
        
        function setupSearchTooltips() {
            const tooltipElements = document.querySelectorAll('[data-tooltip]');
            tooltipElements.forEach(element => {
                // Remove old listener if it exists to prevent duplicates
                element.removeEventListener('click', toggleSearchDelayBreakdown);
                element.addEventListener('click', toggleSearchDelayBreakdown);
            });
        }
        
        function toggleSearchDelayBreakdown(e) {
            e.preventDefault();
            e.stopPropagation();

            const container = e.currentTarget || e.target.closest('[data-tooltip]');
            if (!container) return;

            const breakdownType = container.getAttribute('data-breakdown-type');
            if (!breakdownType) return;
            
            const breakdownId = `search-${breakdownType}-breakdown`;

            // Toggle only this specific breakdown
            const existing = document.getElementById(breakdownId);
            
            // Find the chevron icon - the container itself should be the bar-chart-container
            const barChartContainer = container.classList.contains('bar-chart-container') ? container : container.closest('.bar-chart-container');
            const chevron = barChartContainer ? barChartContainer.querySelector('.expand-chevron') : null;
            
            if (existing) {
                existing.remove();
                // Rotate chevron back to collapsed state (pointing right)
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
                return; // Just close it, don't reopen
            }

            // Rotate chevron to expanded state (pointing down)
            if (chevron) {
                chevron.style.transform = 'rotate(90deg)';
            }

            const stats = window.__searchStats || { delayBreakdown: {}, delayStories: {}, totalStories: 0, cancelled: 0 };

            // Create breakdown container
            const breakdown = document.createElement('div');
            breakdown.id = breakdownId;
            breakdown.__for = container;
            breakdown.style.cssText = `
                margin-top: 10px;
                padding: 12px;
                background: var(--surface-1);
                border: 1px solid var(--border-subtle);
                border-radius: 6px;
                font-size: 12px;
                color: var(--text-default);
            `;
            
            if (breakdownType === 'delayed') {
                breakdown.innerHTML = renderSearchDelayBreakdown(stats, stats.totalStories);
            } else if (breakdownType === 'ontime') {
                breakdown.innerHTML = renderSearchOntimeBreakdown(stats, stats.totalStories);
            } else if (breakdownType === 'accelerated') {
                breakdown.innerHTML = renderSearchAcceleratedBreakdown(stats, stats.totalStories);
            } else if (breakdownType === 'cancelled') {
                breakdown.innerHTML = renderSearchCancelledBreakdown(stats);
            }

            // Insert directly after the clicked container
            container.parentNode.insertBefore(breakdown, container.nextSibling);

            // Enable expand/collapse on rows
            setupSearchDelayBreakdownInteractions();
        }
        
        function renderSearchOntimeBreakdown(stats, totalStories) {
            const done = stats.onTimeDone || 0;
            const notDone = stats.onTimeNotDone || 0;
            const doneStories = (stats.onTimeStories && stats.onTimeStories.done) || [];
            const notDoneStories = (stats.onTimeStories && stats.onTimeStories.notDone) || [];
            
            if (done === 0 && notDone === 0) {
                return '<div style="color:var(--text-muted);">No on-time projects</div>';
            }
            
            const donePct = totalStories ? ((done / totalStories) * 100).toFixed(1) : 0;
            const notDonePct = totalStories ? ((notDone / totalStories) * 100).toFixed(1) : 0;
            
            return (
                '<div class="delay-row" id="search-ontime-done-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Done (' + done + ' / ' + donePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-ontime-done-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-on-time);">' +
                        renderSearchDelayDetails(doneStories) +
                    '</div>' +
                '</div>' +
                '<div class="delay-row" id="search-ontime-notdone-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Not Done (' + notDone + ' / ' + notDonePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-ontime-notdone-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-pending);">' +
                        renderSearchDelayDetails(notDoneStories) +
                    '</div>' +
                '</div>'
            );
        }
        
        function renderSearchAcceleratedBreakdown(stats, totalStories) {
            let acceleratedStories = stats.acceleratedStories || { done: [], notDone: [] };
            
            // Handle backward compatibility: if acceleratedStories is an array (old format), convert it
            if (Array.isArray(acceleratedStories)) {
                const doneStories = acceleratedStories.filter(s => s.isDone);
                const notDoneStories = acceleratedStories.filter(s => !s.isDone);
                acceleratedStories = { done: doneStories, notDone: notDoneStories };
            }
            
            const done = acceleratedStories.done ? acceleratedStories.done.length : 0;
            const notDone = acceleratedStories.notDone ? acceleratedStories.notDone.length : 0;
            const doneStories = acceleratedStories.done || [];
            const notDoneStories = acceleratedStories.notDone || [];
            
            if (done === 0 && notDone === 0) {
                return '<div style="color:var(--text-muted);">No accelerated projects</div>';
            }
            
            const donePct = totalStories ? ((done / totalStories) * 100).toFixed(1) : 0;
            const notDonePct = totalStories ? ((notDone / totalStories) * 100).toFixed(1) : 0;
            
            return (
                '<div class="delay-row" id="search-accelerated-done-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Done (' + done + ' / ' + donePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-accelerated-done-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-on-time);">' +
                        renderSearchDelayDetails(doneStories) +
                    '</div>' +
                '</div>' +
                '<div class="delay-row" id="search-accelerated-notdone-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Not Done (' + notDone + ' / ' + notDonePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-accelerated-notdone-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-pending);">' +
                        renderSearchDelayDetails(notDoneStories) +
                    '</div>' +
                '</div>'
            );
        }
        
        function renderSearchDelayBreakdown(stats, totalStories) {
            const counts = stats.delayBreakdown || {};
            const sorted = Object.keys(counts).map(n => parseInt(n, 10)).sort((a, b) => a - b);
            if (sorted.length === 0) {
                return '<div style="color:var(--text-muted);">No delays recorded</div>';
            }
            
            const rows = sorted.map(delayCount => {
                const value = counts[delayCount] || 0;
                const pct = totalStories ? ((value / totalStories) * 100).toFixed(1) : 0;
                const delayGroup = (stats.delayStories && stats.delayStories[delayCount]) || { done: [], notDone: [] };
                const rowId = `search-delay-row-${delayCount}`;
                const detailsId = `search-delay-details-${delayCount}`;
                
                return (
                    '<div class="delay-row" id="' + rowId + '" style="margin-bottom: 8px; margin-left: 10px;">' +
                        '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                            '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                            '<span style="font-size:13px; color:var(--text-default);">' + delayCount + ' delay' + (delayCount > 1 ? 's' : '') + ' (' + value + ' / ' + pct + '%)</span>' +
                        '</div>' +
                        '<div class="delay-row-details" id="' + detailsId + '" style="display:none; margin-left: 20px;">' +
                            renderSearchDelaySubBreakdown(delayGroup, delayCount, value) +
                        '</div>' +
                    '</div>'
                );
            }).join('');
            return rows;
        }
        
        function renderSearchDelaySubBreakdown(delayGroup, delayCount, totalCount) {
            // Handle backward compatibility: if delayGroup is an array (old format), convert it
            if (Array.isArray(delayGroup)) {
                const doneStories = delayGroup.filter(s => s.isDone);
                const notDoneStories = delayGroup.filter(s => !s.isDone);
                delayGroup = { done: doneStories, notDone: notDoneStories };
            }
            
            const doneStories = delayGroup.done || [];
            const notDoneStories = delayGroup.notDone || [];
            const doneCount = doneStories.length;
            const notDoneCount = notDoneStories.length;
            
            const donePct = totalCount ? ((doneCount / totalCount) * 100).toFixed(1) : 0;
            const notDonePct = totalCount ? ((notDoneCount / totalCount) * 100).toFixed(1) : 0;
            
            return (
                '<div class="delay-row" id="search-delay-' + delayCount + '-done-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Done (' + doneCount + ' / ' + donePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-delay-' + delayCount + '-done-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-on-time);">' +
                        renderSearchDelayDetails(doneStories) +
                    '</div>' +
                '</div>' +
                '<div class="delay-row" id="search-delay-' + delayCount + '-notdone-row" style="margin-bottom: 8px; margin-left: 10px;">' +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:var(--text-muted);">▶</span>' +
                        '<span style="font-size:13px; color:var(--text-default);">Not Done (' + notDoneCount + ' / ' + notDonePct + '%)</span>' +
                    '</div>' +
                    '<div class="delay-row-details" id="search-delay-' + delayCount + '-notdone-details" style="display:none; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-pending);">' +
                        renderSearchDelayDetails(notDoneStories) +
                    '</div>' +
                '</div>'
            );
        }
        
        function compareByTeamThenTitle(a, b) {
            const ta = (a.teamName || '').toLowerCase();
            const tb = (b.teamName || '').toLowerCase();
            if (ta !== tb) return ta < tb ? -1 : 1;
            const sa = (a.title || '').toLowerCase();
            const sb = (b.title || '').toLowerCase();
            if (sa !== sb) return sa < sb ? -1 : 1;
            return 0;
        }

        function renderSearchDelayDetails(stories) {
            if (!stories || !stories.length) return '<div style="color:var(--text-muted);">No items</div>';
            const sorted = [...stories].sort(compareByTeamThenTitle);
            return sorted.map(s => {
                const title = (s.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const team = (s.teamName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return '<div style="font-size:12px; color:var(--text-default); padding:2px 0;">' +
                    (team ? '<span style="color:var(--text-muted);">[' + team + ']</span> ' : '') +
                    title +
                '</div>';
            }).join('');
        }

        function renderSearchCancelledBreakdown(stats) {
            const cancelled = Array.isArray(stats.cancelledStories) ? stats.cancelledStories : [];
            if (cancelled.length === 0) {
                return '<div style="color:var(--text-muted);">No cancelled projects</div>';
            }
            const sorted = [...cancelled].sort(compareByTeamThenTitle);
            const items = sorted.map(s => {
                const title = (s.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const team = (s.teamName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return '<div style="font-size:12px; color:var(--text-default); padding:2px 0;">' +
                    (team ? '<span style="color:var(--text-muted);">[' + team + ']</span> ' : '') +
                    title +
                '</div>';
            }).join('');
            return '<div style="display:block; margin-left: 20px; padding:8px; background:var(--surface-0); border-left: 2px solid var(--stats-delayed);">' + items + '</div>';
        }
        
        function setupSearchDelayBreakdownInteractions() {
            const rows = document.querySelectorAll('[id$="-breakdown"] .delay-row');
            rows.forEach(row => {
                const details = row.querySelector('.delay-row-details');
                const header = row.querySelector('.delay-row-header');
                const arrow = header ? header.querySelector('span:first-child') : null;
                
                // Remove any existing click handler to prevent duplicates
                if (header && header._toggleHandler) {
                    header.removeEventListener('click', header._toggleHandler);
                }
                
                const toggle = () => {
                    if (!details) return;
                    const isOpen = details.style.display !== 'none';
                    details.style.display = isOpen ? 'none' : 'block';
                    if (arrow) {
                        arrow.textContent = isOpen ? '▶' : '▼';
                    }
                };
                
                // Store the handler reference for later removal
                if (header) {
                    header._toggleHandler = toggle;
                    header.addEventListener('click', toggle);
                }
            });
        }
        
        /**
         * Open story details modal (read-only)
         * @param {Object} storyData - Story data object
         */
        function openStoryDetailsModal(storyData) {
            // Check if modal exists
            const storyModal = document.getElementById('storyDetailsModal');
            if (!storyModal) {
                
                return;
            }
            
            // Set modal title
            document.getElementById('storyDetailsTitle').textContent = `Story Details: ${storyData.title}`;
            
            // Populate basic fields
            document.getElementById('viewTitle').textContent = storyData.title || '';
            document.getElementById('viewTeam').textContent = storyData.teamName || '';
            document.getElementById('viewEpic').textContent = storyData.epicName || '';
            
            // Handle start/end dates
            const startValue = storyData.startDate || storyData.startMonth || storyData.start || '';
            const endValue = storyData.endDate || storyData.endMonth || storyData.end || '';
            document.getElementById('viewStart').textContent = startValue || 'Not specified';
            document.getElementById('viewEnd').textContent = endValue || 'Not specified';
            
            // Handle bullets
            let bulletsText = '';
            if (storyData.bullets) {
                if (Array.isArray(storyData.bullets)) {
                    bulletsText = storyData.bullets.join('\n');
                } else if (typeof storyData.bullets === 'string') {
                    bulletsText = storyData.bullets;
                } else {
                    bulletsText = String(storyData.bullets);
                }
            }
            document.getElementById('viewBullets').textContent = bulletsText || 'None';
            
            // Handle Director/VP ID
            let directorVPIdText = '';
            if (storyData.directorVPId) {
                directorVPIdText = String(storyData.directorVPId);
            }
            document.getElementById('viewDirectorVPId').textContent = directorVPIdText || 'None';
            
            // Handle IMO
            let imoText = '';
            if (storyData.imo) {
                imoText = String(storyData.imo);
            }
            document.getElementById('viewIMO').textContent = imoText || 'None';
            
            // Handle Priority
            let priorityText = '';
            if (storyData.priority) {
                priorityText = String(storyData.priority);
            }
            document.getElementById('viewPriority').textContent = priorityText || 'None';
            
            // Handle Country Flags
            const flags = storyData.countryFlags || [];
            document.getElementById('viewFlagGlobal').checked = flags.includes('Global');
            document.getElementById('viewFlagCzechia').checked = flags.includes('Czechia');
            document.getElementById('viewFlagHungary').checked = flags.includes('Hungary');
            document.getElementById('viewFlagIceland').checked = flags.includes('Iceland');
            document.getElementById('viewFlagItaly').checked = flags.includes('Italy');
            document.getElementById('viewFlagPortugal').checked = flags.includes('Portugal');
            document.getElementById('viewFlagSlovakia').checked = flags.includes('Slovakia');
            document.getElementById('viewFlagSlovenia').checked = flags.includes('Slovenia');
            document.getElementById('viewFlagCroatia').checked = flags.includes('Croatia');
            document.getElementById('viewFlagSpain').checked = flags.includes('Spain');
            document.getElementById('viewFlagUK').checked = flags.includes('UK');
            document.getElementById('viewFlagFrance').checked = flags.includes('France');
            
            // Handle Include in Product Roadmap
            document.getElementById('viewIncludeInProductRoadmap').checked = storyData.includeInProductRoadmap || false;
            
            // Handle KTLO-specific fields
            const isKTLO = storyData.epicName === 'KTLO';
            const ktloPositionGroup = document.getElementById('viewKTLOPositionGroup');
            const ktloMonthlySection = document.getElementById('viewKTLOMonthlySection');
            
            if (isKTLO) {
                // KTLO Position
                const position = storyData.position ? 'Top (Before the Epics)' : 'Bottom (After the Epics)';
                document.getElementById('viewKTLOPosition').textContent = position;
                ktloPositionGroup.style.display = 'block';
                
                // KTLO Monthly Data (if available)
                if (storyData.monthlyData && Object.keys(storyData.monthlyData).length > 0) {
                    populateKTLOMonthlyData(storyData.monthlyData);
                    ktloMonthlySection.style.display = 'block';
                } else {
                    ktloMonthlySection.style.display = 'none';
                }
            } else {
                ktloPositionGroup.style.display = 'none';
                ktloMonthlySection.style.display = 'none';
            }
            
            // Handle BTL-specific fields
            const isBTL = storyData.sourceType === 'btl';
            const btlDateAddedGroup = document.getElementById('viewBTLDateAddedGroup');
            const btlDescriptionGroup = document.getElementById('viewBTLDescriptionGroup');
            
            if (isBTL) {
                if (storyData.dateAdded) {
                    document.getElementById('viewBTLDateAdded').textContent = storyData.dateAdded;
                    btlDateAddedGroup.style.display = 'block';
                } else {
                    btlDateAddedGroup.style.display = 'none';
                }
                
                if (storyData.description) {
                    document.getElementById('viewBTLDescription').textContent = String(storyData.description);
                    btlDescriptionGroup.style.display = 'block';
                } else {
                    btlDescriptionGroup.style.display = 'none';
                }
            } else {
                btlDateAddedGroup.style.display = 'none';
                btlDescriptionGroup.style.display = 'none';
            }
            
            // Handle checkboxes
            populateCheckboxes(storyData);
            
            // Handle status fields
            populateStatusFields(storyData);
            
            // Handle timeline changes
            populateTimelineChanges(storyData);
            
            // Show modal
            const modalElement = document.getElementById('storyDetailsModal');
            modalElement.style.display = 'flex';
            
            // Keep read-only status values selectable by the shared checkbox styles.
            setTimeout(() => {
                const checkboxIds = ['viewNewStory', 'viewDone', 'viewCancelled', 'viewInfo', 
                                   'viewTimelineChanges', 'viewAtRisk', 'viewProposed', 
                                   'viewTransferredIn', 'viewTransferredOut'];
                checkboxIds.forEach(id => {
                    const checkbox = document.getElementById(id);
                    if (checkbox) {
                        checkbox.disabled = false;
                    }
                });
            }, 100);
        }
        
        /**
         * Populate checkboxes based on story data
         */
        function populateCheckboxes(storyData) {
            // Check if timeline changes exist - can be either array or object with changes property
            const changes = Array.isArray(storyData.roadmapChanges) 
                ? storyData.roadmapChanges 
                : storyData.roadmapChanges?.changes;
            const hasTimelineChanges = !!(changes && changes.length > 0);
            
            // Set checkbox states
            document.getElementById('viewNewStory').checked = storyData.isNewStory || false;
            document.getElementById('viewDone').checked = storyData.isDone || false;
            document.getElementById('viewCancelled').checked = storyData.isCancelled || false;
            document.getElementById('viewInfo').checked = storyData.isInfo || false;
            document.getElementById('viewTimelineChanges').checked = hasTimelineChanges;
            document.getElementById('viewAtRisk').checked = storyData.isAtRisk || false;
            document.getElementById('viewProposed').checked = storyData.isProposed || false;
            document.getElementById('viewTransferredIn').checked = storyData.isTransferredIn || false;
            document.getElementById('viewTransferredOut').checked = storyData.isTransferredOut || false;
        }
        
        /**
         * Populate KTLO monthly data
         */
        function populateKTLOMonthlyData(monthlyData) {
            const container = document.getElementById('viewKTLOMonthsContainer');
            container.innerHTML = '';
            
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            
            months.forEach(month => {
                const data = monthlyData[month];
                if (data && (data.teamSize || data.percentage || data.description)) {
                    const monthDiv = document.createElement('div');
                    monthDiv.className = 'detail-entry';
                    
                    monthDiv.innerHTML = `
                        <h5 style="margin: 0 0 10px 0; text-transform: uppercase;">${month}</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label>Team Size:</label>
                                <div class="readonly-field">${data.teamSize || 'Not specified'}</div>
                            </div>
                            <div class="form-group">
                                <label>KTLO %:</label>
                                <div class="readonly-field">${data.percentage || 'Not specified'}</div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Description:</label>
                            <div class="readonly-field">${data.description || 'None'}</div>
                        </div>
                    `;
                    
                    container.appendChild(monthDiv);
                }
            });
        }
        
        /**
         * Populate status fields
         */
        function populateStatusFields(storyData) {
            // Always show status fields section since checkboxes are always visible
            // Individual field visibility is controlled by checkbox state
            
            // Done status
            if (storyData.isDone) {
                const doneInfo = storyData.doneInfo || {};
                const roadmapDoneInfo = storyData.roadmapChanges?.doneInfo || {};
                
                const doneDate = doneInfo.date || roadmapDoneInfo.date || storyData.doneDate || 'Not specified';
                const doneNotes = doneInfo.notes || roadmapDoneInfo.notes || storyData.doneNotes || 'None';
                
                document.getElementById('viewDoneDate').textContent = doneDate;
                document.getElementById('viewDoneNotes').textContent = doneNotes;
                document.getElementById('viewDoneFields').style.display = 'block';
            } else {
                document.getElementById('viewDoneFields').style.display = 'none';
            }
            
            // Cancelled status
            if (storyData.isCancelled) {
                const cancelInfo = storyData.cancelInfo || {};
                const roadmapCancelInfo = storyData.roadmapChanges?.cancelInfo || {};
                
                const cancelDate = cancelInfo.date || roadmapCancelInfo.date || storyData.cancelDate || 'Not specified';
                const cancelNotes = cancelInfo.notes || roadmapCancelInfo.notes || storyData.cancelNotes || 'None';
                
                document.getElementById('viewCancelDate').textContent = cancelDate;
                document.getElementById('viewCancelNotes').textContent = cancelNotes;
                document.getElementById('viewCancelFields').style.display = 'block';
            } else {
                document.getElementById('viewCancelFields').style.display = 'none';
            }
            
            // At Risk status
            if (storyData.isAtRisk) {
                // Check multiple possible locations for At Risk data
                const atRiskInfo = storyData.atRiskInfo || {};
                const roadmapAtRiskInfo = storyData.roadmapChanges?.atRiskInfo || {};
                
                // Try different property names (different data sources use different names)
                const atRiskDate = atRiskInfo.date || 
                                 roadmapAtRiskInfo.date || 
                                 storyData.atRiskDate || 
                                 storyData.riskDate || 
                                 'Not specified';
                                 
                const atRiskNotes = atRiskInfo.notes || 
                                  roadmapAtRiskInfo.notes || 
                                  storyData.atRiskNotes || 
                                  storyData.riskNotes || 
                                  'None';
                
                document.getElementById('viewAtRiskDate').textContent = atRiskDate;
                document.getElementById('viewAtRiskNotes').textContent = atRiskNotes;
                document.getElementById('viewAtRiskFields').style.display = 'block';
            } else {
                document.getElementById('viewAtRiskFields').style.display = 'none';
            }
            
            // New Story status
            if (storyData.isNewStory) {
                const newStoryInfo = storyData.newStoryInfo || {};
                const roadmapNewStoryInfo = storyData.roadmapChanges?.newStoryInfo || {};
                
                const newStoryDate = newStoryInfo.date || roadmapNewStoryInfo.date || storyData.newDate || 'Not specified';
                const newStoryNotes = newStoryInfo.notes || roadmapNewStoryInfo.notes || storyData.newNotes || 'None';
                
                document.getElementById('viewNewStoryDate').textContent = newStoryDate;
                document.getElementById('viewNewStoryNotes').textContent = newStoryNotes;
                document.getElementById('viewNewStoryFields').style.display = 'block';
            } else {
                document.getElementById('viewNewStoryFields').style.display = 'none';
            }
            
            // Info status
            if (storyData.isInfo) {
                const infoInfo = storyData.infoInfo || {};
                const roadmapInfoInfo = storyData.roadmapChanges?.infoInfo || {};
                
                // Clear existing info entries
                const infoContainer = document.getElementById('viewInfoEntries');
                if (infoContainer) {
                    infoContainer.innerHTML = '';
                }
                
                if (Array.isArray(roadmapInfoInfo) && roadmapInfoInfo.length > 0) {
                    // Multiple info entries - display all of them
                    roadmapInfoInfo.forEach((entry, index) => {
                        if (entry && (entry.date || entry.notes)) {
                            const entryDiv = document.createElement('div');
                            entryDiv.className = 'detail-entry';
                            
                            entryDiv.innerHTML = `
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <strong>Info Entry #${index + 1}</strong>
                                </div>
                                <div class="inline-group">
                                    <div class="form-group">
                                        <label>Info Date:</label>
                                        <div class="readonly-field">${entry.date || 'Not specified'}</div>
                                    </div>
                                    <div class="form-group">
                                        <label>Information Details:</label>
                                        <div class="readonly-field">${entry.notes || 'None'}</div>
                                    </div>
                                </div>
                            `;
                            
                            infoContainer.appendChild(entryDiv);
                        }
                    });
                    
                    // Show the info section
                    document.getElementById('viewInfoFields').style.display = 'block';
                } else if (roadmapInfoInfo && roadmapInfoInfo.date) {
                    // Single info entry (backward compatibility)
                    const entryDiv = document.createElement('div');
                    entryDiv.className = 'detail-entry';
                    
                    entryDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <strong>Info Entry #1</strong>
                        </div>
                        <div class="inline-group">
                            <div class="form-group">
                                <label>Info Date:</label>
                                <div class="readonly-field">${roadmapInfoInfo.date || 'Not specified'}</div>
                            </div>
                            <div class="form-group">
                                <label>Information Details:</label>
                                <div class="readonly-field">${roadmapInfoInfo.notes || 'None'}</div>
                            </div>
                        </div>
                    `;
                    
                    infoContainer.appendChild(entryDiv);
                    document.getElementById('viewInfoFields').style.display = 'block';
                } else {
                    // Fallback to old format
                    const entryDiv = document.createElement('div');
                    entryDiv.className = 'detail-entry';
                    
                    entryDiv.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <strong>Info Entry #1</strong>
                        </div>
                        <div class="inline-group">
                            <div class="form-group">
                                <label>Info Date:</label>
                                <div class="readonly-field">${infoInfo.date || storyData.infoDate || 'Not specified'}</div>
                            </div>
                            <div class="form-group">
                                <label>Information Details:</label>
                                <div class="readonly-field">${infoInfo.notes || storyData.infoNotes || 'None'}</div>
                            </div>
                        </div>
                    `;
                    
                    infoContainer.appendChild(entryDiv);
                    document.getElementById('viewInfoFields').style.display = 'block';
                }
            } else {
                document.getElementById('viewInfoFields').style.display = 'none';
            }
            
            // Transferred In status
            if (storyData.isTransferredIn) {
                const transferredInInfo = storyData.transferredInInfo || {};
                const roadmapTransferredInInfo = storyData.roadmapChanges?.transferredInInfo || {};
                
                const transferredInDate = transferredInInfo.date || roadmapTransferredInInfo.date || storyData.transferredInDate || 'Not specified';
                const transferredInNotes = transferredInInfo.notes || roadmapTransferredInInfo.notes || storyData.transferredInNotes || 'None';
                
                document.getElementById('viewTransferredInDate').textContent = transferredInDate;
                document.getElementById('viewTransferredInNotes').textContent = transferredInNotes;
                document.getElementById('viewTransferredInFields').style.display = 'block';
            } else {
                document.getElementById('viewTransferredInFields').style.display = 'none';
            }
            
            // Transferred Out status
            if (storyData.isTransferredOut) {
                const transferredOutInfo = storyData.transferredOutInfo || {};
                const roadmapTransferredOutInfo = storyData.roadmapChanges?.transferredOutInfo || {};
                
                const transferredOutDate = transferredOutInfo.date || roadmapTransferredOutInfo.date || storyData.handedOverDate || 'Not specified';
                const transferredOutNotes = transferredOutInfo.notes || roadmapTransferredOutInfo.notes || storyData.handedOverNotes || 'None';
                
                document.getElementById('viewTransferredOutDate').textContent = transferredOutDate;
                document.getElementById('viewTransferredOutNotes').textContent = transferredOutNotes;
                document.getElementById('viewTransferredOutFields').style.display = 'block';
            } else {
                document.getElementById('viewTransferredOutFields').style.display = 'none';
            }
            
            // Proposed status
            if (storyData.isProposed) {
                const proposedInfo = storyData.proposedInfo || {};
                const roadmapProposedInfo = storyData.roadmapChanges?.proposedInfo || {};
                
                const proposedDate = proposedInfo.date || roadmapProposedInfo.date || storyData.proposedDate || 'Not specified';
                const proposedNotes = proposedInfo.notes || roadmapProposedInfo.notes || storyData.proposedNotes || 'None';
                
                document.getElementById('viewProposedDate').textContent = proposedDate;
                document.getElementById('viewProposedNotes').textContent = proposedNotes;
                document.getElementById('viewProposedFields').style.display = 'block';
            } else {
                document.getElementById('viewProposedFields').style.display = 'none';
            }
        }
        
        /**
         * Populate timeline changes
         */
        function populateTimelineChanges(storyData) {
            const timelineSection = document.getElementById('viewTimelineChangesSection');
            const container = document.getElementById('viewChangesContainer');
            
            // Check for timeline changes - can be either array or object with changes property
            const changes = Array.isArray(storyData.roadmapChanges) 
                ? storyData.roadmapChanges 
                : storyData.roadmapChanges?.changes;
            
            if (changes && changes.length > 0) {
                container.innerHTML = '';
                
                changes.forEach((change, index) => {
                    const changeDiv = document.createElement('div');
                    changeDiv.className = 'detail-entry detail-entry--large';
                    
                    const startMoved = change.prevStartDate && change.newStartDate
                        && change.prevStartDate !== change.newStartDate;
                    const startRows = startMoved ? `
                        <div class="inline-group">
                            <div class="form-group">
                                <label>Previous Start Date:</label>
                                <div class="readonly-field">${change.prevStartDate}</div>
                            </div>
                            <div class="form-group">
                                <label>New Start Date:</label>
                                <div class="readonly-field">${change.newStartDate}</div>
                            </div>
                        </div>
                    ` : '';

                    changeDiv.innerHTML = `
                        <h5 style="margin: 0 0 10px 0;">Timeline #${index + 1}</h5>
                        <div class="inline-group">
                            <div class="form-group">
                                <label>Change Date:</label>
                                <div class="readonly-field">${change.date || change.changeDate || 'Not specified'}</div>
                            </div>
                            <div class="form-group">
                                <label>Previous End Date:</label>
                                <div class="readonly-field">${change.prevEndDate || change.previousEndDate || 'Not specified'}</div>
                            </div>
                            <div class="form-group">
                                <label>New End Date:</label>
                                <div class="readonly-field">${change.newEndDate || 'Not specified'}</div>
                            </div>
                        </div>
                        ${startRows}
                        <div class="form-group">
                            <label>Change Notes:</label>
                            <div class="readonly-field">${change.description || change.changeNotes || 'None'}</div>
                        </div>
                    `;
                    
                    container.appendChild(changeDiv);
                });
                
                timelineSection.style.display = 'block';
            } else {
                timelineSection.style.display = 'none';
            }
        }
        
        /**
         * Close story details modal
         */
        function closeStoryDetailsModal() {
            document.getElementById('storyDetailsModal').style.display = 'none';
        }
        
        /**
         * Handle clicks outside modal to close it
         */
        window.addEventListener('click', function(event) {
            const modal = document.getElementById('storyDetailsModal');
            if (event.target === modal) {
                closeStoryDetailsModal();
            }
        });
        
        /**
         * Handle Escape key to close modal
         */
        document.addEventListener('keydown', function(event) {
            // Check if user is currently typing in an editable element
            const activeElement = document.activeElement;
            const isEditable = activeElement && (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.contentEditable === 'true'
            );
            
            // Always allow Escape key to work (to close modals)
            if (event.key === 'Escape') {
                closeStoryDetailsModal();
                closeSearchStatsModal();
                return;
            }
            
            // Don't handle other shortcuts when user is typing in an editable field
            if (isEditable) {
                return;
            }
            
            // Shift-S to open stats dialog
            if (event.shiftKey && event.key === 'S') {
                event.preventDefault();
                openSearchStatsModal();
            }
        });
        
        /**
         * Add click handlers to story items in search results
         * @param {Array} storiesData - Array of story data objects
         */
        function addStoryClickHandlers(storiesData) {
            // Find all story items in the rendered roadmap
            const storyItems = document.querySelectorAll('.story-item, .ktlo-story');

            storyItems.forEach((storyElement) => {
                // Extract story identification from data attributes
                const epicName = storyElement.dataset.epicName;
                const storyTitle = storyElement.dataset.storyTitle;
                const storyIndex = storyElement.dataset.storyIndex;
                const storyId = storyElement.dataset.jsonStoryId;

                // Find matching story data
                const storyData = findStoryData(storiesData, epicName, storyTitle, storyIndex, storyId);
                
                if (storyData) {
                    // Add click handler
                    storyElement.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        openStoryDetailsModal(storyData);
                    });
                    
                    // Add visual indicator for clickable stories
                    storyElement.style.cursor = 'pointer';
                    storyElement.title = 'Click to view story details';
                }
            });
        }
        
        /**
         * Find story data by epic name, title, and index
         * @param {Array} storiesData - Array of story data objects
         * @param {string} epicName - Epic name
         * @param {string} storyTitle - Story title
         * @param {string} storyIndex - Story index
         * @returns {Object|null} - Story data object or null if not found
         */
        function findStoryData(storiesData, epicName, storyTitle, storyIndex, storyId) {
            return storiesData.find(story => {
                // Primary: match by storyId (unique per file, immune to title formatting)
                if (storyId && story.storyId && story.storyId === storyId) {
                    return true;
                }

                // Match by epic name and story title (builder view)
                if (story.epicName === epicName && story.title === storyTitle) {
                    return true;
                }

                // In cross-team search, data-epic-name is the team name (one epic per team)
                if (story.teamName === epicName && story.title === storyTitle) {
                    return true;
                }

                // Fallback: match by title only for unique titles
                if (story.title === storyTitle) {
                    const titleMatches = storiesData.filter(s => s.title === storyTitle);
                    if (titleMatches.length === 1) {
                        return true;
                    }
                }
                
                return false;
            });
        }
        
        // Directory selection lives in the top nav (shared with Builder).
        // Kept as a shim so any legacy callers still work.
        async function selectDirectory() {
            await directoryStore.select();
        }

        async function warmDirectoryCache({ refresh = false } = {}) {
            const dirStatus = document.getElementById('directoryStatus');

            dirStatus.textContent = `Scanning ${selectedDirectory.name}…`;
            dirStatus.dataset.state = '';

            try {
                const files = await IMOUtility.scanRoadmapDirectory(selectedDirectory, { refresh });
                const count = files.length;
                dirStatus.textContent = `Selected: ${selectedDirectory.name} (${count} roadmap${count === 1 ? '' : 's'})`;
            } catch (error) {
                dirStatus.dataset.state = 'error';
                dirStatus.textContent = 'Failed to scan: ' + error.message;
            }
        }

        function showDirectoryPickerUnsupported() {
            const dirStatus = document.getElementById('directoryStatus');
            if (dirStatus) {
                dirStatus.dataset.state = 'error';
                dirStatus.innerHTML = '<strong>This browser may not fully support folder selection</strong> - Chrome or Edge recommended.';
            }
        }
        
        /**
         * Handle Enter key in search input
         */
        function handleSearchKeyPress(event) {
            if (event.key === 'Enter') {
                performSearch();
            }
        }
        
        /**
         * Handle Enter key in title search input
         */
        function handleTitleSearchKeyPress(event) {
            if (event.key === 'Enter') {
                performTitleSearch();
            }
        }
        
        /**
         * Perform the IMO/Timeline search
         */
        async function performSearch() {
            try {
                // Validate inputs
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                        return;
                    }

                const searchQuery = document.getElementById('searchInput').value.trim();
                const priorityValue = document.getElementById('prioritySelect')?.value || '';
                if (!searchQuery && !priorityValue) {
                    alert('Please enter a CP/Project ID or select a priority');
                        return;
                    }

                const searchLabel = searchQuery
                    ? `"${searchQuery}"${priorityValue ? ` + Priority: ${priorityValue}` : ''}`
                    : `Priority: ${priorityValue}`;

                // Show loading state
                showLoadingState(`Searching for ${searchLabel}...`);

                // Scan directory for roadmap files
                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);

                if (roadmapFiles.length === 0) {
                    showMessage('No roadmap JSON files found in the selected directory', 'warning');
                    return;
                }

                // Extract and search stories
                const allStories = IMOUtility.aggregateStoriesAcrossTeams(roadmapFiles, builderRoadmapYear);

                // Narrow by IMO if provided, otherwise start with all stories
                let matchingStories = searchQuery
                    ? IMOUtility.filterStoriesByIMO(allStories, searchQuery)
                    : allStories.slice();

                lastRoadmapFiles = roadmapFiles;

                matchingStories = applyAdditionalFilters(matchingStories, roadmapFiles, { skipIMO: true });

                if (matchingStories.length === 0) {
                    showMessage(`No stories found for ${searchLabel}`, 'info');
                    return;
                }

                // Store results and display
                currentResults = matchingStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(matchingStories, searchLabel, null, teamInfoMap);

                // Enable stats button
                document.getElementById('searchStatsBtn').disabled = false;

            } catch (error) {

                showMessage('Search error: ' + error.message, 'error');
            }
        }

        // Temporary variable for search results force text below (one-time action)
        let searchTempForceTextBelow = false;
        let lastSearchQuery = null;
        let lastSearchRange = null;

        // Team swimlanes can be dragged into any order. The order is a list of
        // team names kept in this browser and applied to every search.
        const TEAM_ORDER_KEY = 'cross-team-search-team-order';

        function loadTeamOrder() {
            try {
                const saved = JSON.parse(localStorage.getItem(TEAM_ORDER_KEY) || '[]');
                return Array.isArray(saved) ? saved.filter((name) => typeof name === 'string') : [];
            } catch {
                return [];
            }
        }

        function saveTeamOrder(order) {
            try {
                if (order.length) localStorage.setItem(TEAM_ORDER_KEY, JSON.stringify(order));
                else localStorage.removeItem(TEAM_ORDER_KEY);
            } catch {}
        }

        function rerenderSearchResults() {
            if (!currentResults) return;
            displaySearchResults(currentResults, lastSearchQuery, lastSearchRange, buildTeamInfoMap(lastRoadmapFiles));
        }

        // Teams in the order the current results show them
        let lastOrderedTeamNames = [];

        function applyTeamOrder(newVisibleOrder) {
            saveTeamOrder(mergeTeamOrder(loadTeamOrder(), newVisibleOrder));
            rerenderSearchResults();
        }

        /**
         * "Reorder teams" popover next to the team list in the results
         * summary. Each change applies straight away, so the roadmap behind it
         * reorders live. It lives on document.body because every change
         * re-renders the results, and it re-anchors to the new link after.
         */
        let teamOrderPopover = null;

        function escapeTeamName(name) {
            return String(name).replace(/[&<>"']/g, (c) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        function positionTeamOrderPopover() {
            const link = document.getElementById('reorderTeamsLink');
            if (!teamOrderPopover || !link) return;
            const rect = link.getBoundingClientRect();
            const width = teamOrderPopover.offsetWidth;
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
            teamOrderPopover.style.left = `${left + window.scrollX}px`;
            teamOrderPopover.style.top = `${rect.bottom + window.scrollY + 6}px`;
        }

        function renderTeamOrderList(focusTeam = null, focusAction = null) {
            if (!teamOrderPopover) return;
            const names = lastOrderedTeamNames;
            const list = teamOrderPopover.querySelector('.team-order-list');
            list.innerHTML = names.map((name, index) => `
                <li class="team-order-item" draggable="true" data-team="${escapeTeamName(name)}">
                    <span class="team-order-grip" aria-hidden="true">⠿</span>
                    <span class="team-order-name">${escapeTeamName(name)}</span>
                    <button type="button" class="team-order-move" data-action="up" aria-label="Move ${escapeTeamName(name)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="team-order-move" data-action="down" aria-label="Move ${escapeTeamName(name)} down" ${index === names.length - 1 ? 'disabled' : ''}>↓</button>
                </li>
            `).join('');
            teamOrderPopover.querySelector('.team-order-reset').disabled = loadTeamOrder().length === 0;

            if (focusTeam) {
                const item = Array.from(list.children).find((li) => li.dataset.team === focusTeam);
                const button = item?.querySelector(`[data-action="${focusAction}"]:not(:disabled)`)
                    || item?.querySelector('.team-order-move:not(:disabled)');
                button?.focus();
            }
        }

        function refreshTeamOrderPopover(focusTeam, focusAction) {
            renderTeamOrderList(focusTeam, focusAction);
            positionTeamOrderPopover();
        }

        function toggleTeamOrderPopover() {
            if (teamOrderPopover) { closeTeamOrderPopover(); return; }

            const popover = document.createElement('div');
            popover.className = 'team-order-popover';
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', 'Reorder teams');
            popover.innerHTML = `
                <div class="team-order-header">Drag or use the arrows to reorder teams</div>
                <ul class="team-order-list"></ul>
                <div class="team-order-footer">
                    <button type="button" class="team-order-reset">Reset to A–Z</button>
                </div>
            `;
            document.body.appendChild(popover);
            teamOrderPopover = popover;

            let draggedTeam = null;
            const list = /** @type {HTMLUListElement} */ (popover.querySelector('.team-order-list'));
            /** @returns {HTMLElement | null} */
            const itemFrom = (event) => event.target instanceof Element ? event.target.closest('.team-order-item') : null;
            const clearDropMarks = () => list.querySelectorAll('.team-order-item')
                .forEach((li) => li.classList.remove('team-drop-before', 'team-drop-after'));
            const placementFor = (li, event) => {
                const rect = li.getBoundingClientRect();
                return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            };

            list.addEventListener('click', (event) => {
                const button = event.target instanceof Element ? event.target.closest('.team-order-move') : null;
                if (!button) return;
                const team = button.closest('.team-order-item')?.getAttribute('data-team');
                const names = lastOrderedTeamNames;
                const index = names.indexOf(team);
                const action = button.getAttribute('data-action');
                const target = names[action === 'up' ? index - 1 : index + 1];
                if (!target) return;
                applyTeamOrder(moveTeam(names, team, target, action === 'up' ? 'before' : 'after'));
                refreshTeamOrderPopover(team, action);
            });
            list.addEventListener('dragstart', (event) => {
                const li = itemFrom(event);
                if (!li) return;
                draggedTeam = li.dataset.team;
                li.classList.add('team-dragging');
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', draggedTeam);
                }
            });
            list.addEventListener('dragover', (event) => {
                const li = itemFrom(event);
                if (!draggedTeam || !li || li.dataset.team === draggedTeam) return;
                event.preventDefault();
                clearDropMarks();
                li.classList.add(placementFor(li, event) === 'before' ? 'team-drop-before' : 'team-drop-after');
            });
            list.addEventListener('drop', (event) => {
                const li = itemFrom(event);
                if (!draggedTeam || !li || li.dataset.team === draggedTeam) return;
                event.preventDefault();
                applyTeamOrder(moveTeam(lastOrderedTeamNames, draggedTeam, li.dataset.team, placementFor(li, event)));
                refreshTeamOrderPopover();
            });
            list.addEventListener('dragend', () => {
                draggedTeam = null;
                clearDropMarks();
                list.querySelectorAll('.team-dragging').forEach((li) => li.classList.remove('team-dragging'));
            });
            popover.querySelector('.team-order-reset').addEventListener('click', () => {
                saveTeamOrder([]);
                rerenderSearchResults();
                refreshTeamOrderPopover();
            });

            const onOutsideClick = (event) => {
                if (!(event.target instanceof Element)) return;
                if (popover.contains(event.target) || event.target.closest('#reorderTeamsLink')) return;
                closeTeamOrderPopover();
            };
            const onKeyDown = (event) => {
                if (event.key !== 'Escape') return;
                closeTeamOrderPopover();
                document.getElementById('reorderTeamsLink')?.focus();
            };
            document.addEventListener('mousedown', onOutsideClick);
            document.addEventListener('keydown', onKeyDown);
            window.addEventListener('resize', positionTeamOrderPopover);

            closeTeamOrderPopover = () => {
                document.removeEventListener('mousedown', onOutsideClick);
                document.removeEventListener('keydown', onKeyDown);
                window.removeEventListener('resize', positionTeamOrderPopover);
                popover.remove();
                teamOrderPopover = null;
                document.getElementById('reorderTeamsLink')?.setAttribute('aria-expanded', 'false');
                closeTeamOrderPopover = () => {};
            };

            document.getElementById('reorderTeamsLink')?.setAttribute('aria-expanded', 'true');
            renderTeamOrderList();
            positionTeamOrderPopover();
            /** @type {HTMLElement | null} */ (popover.querySelector('.team-order-move:not(:disabled)'))?.focus();
        }
        
        /**
         * Handle force text below toggle in search results
         */
        // Event delegation for the dynamically-rendered search toggle
        document.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'search-force-text-below-toggle') {
                handleSearchForceTextBelowToggle();
            }
        });

        // Epic titles on top / title-only stories share the builder's saved
        // preference, so both views show roadmaps the same way.
        function handleSearchEpicTitleTopToggle() {
            const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('search-epic-title-top-toggle'));
            if (!toggle) return;
            ConfigUtility.setEpicTitleTop(toggle.checked);
            displaySearchResults(currentResults, lastSearchQuery, null, buildTeamInfoMap(lastRoadmapFiles));
        }

        function handleSearchHideStoryTextToggle() {
            const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('search-hide-story-text-toggle'));
            if (!toggle) return;
            ConfigUtility.setHideStoryText(toggle.checked);
            displaySearchResults(currentResults, lastSearchQuery, null, buildTeamInfoMap(lastRoadmapFiles));
        }

        // The nav status-style toggle changes between hover bar and side text
        // box layouts; rebuild the current results so they pick up the new mode.
        document.addEventListener('roadmap-status-style-changed', () => {
            if (!currentResults) return;
            const teamInfoMap = buildTeamInfoMap(lastRoadmapFiles);
            displaySearchResults(currentResults, lastSearchQuery, null, teamInfoMap);
        });


        function handleSearchForceTextBelowToggle() {
            const toggle = document.getElementById('search-force-text-below-toggle');
            if (toggle) {
                // Use temporary variable instead of saving to localStorage
                searchTempForceTextBelow = toggle.checked;
                window.searchTempForceTextBelow = searchTempForceTextBelow;
                // Regenerate the search results to apply placement
                const teamInfoMap = buildTeamInfoMap(lastRoadmapFiles);
                displaySearchResults(currentResults, lastSearchQuery, null, teamInfoMap);
                
                // Restore checkbox state after regeneration
                setTimeout(() => {
                    const newToggle = document.getElementById('search-force-text-below-toggle');
                    if (newToggle) {
                        newToggle.checked = searchTempForceTextBelow;
                    }
                }, 100);
            }
        }
        
        /**
         * Build a map of team information from roadmap files
         */
        function buildTeamInfoMap(roadmapFiles) {
            const teamInfoMap = {};
            if (!roadmapFiles) return teamInfoMap;
            
            for (const roadmap of roadmapFiles) {
                const teamData = roadmap.teamData;
                if (!teamData) continue;
                
                const teamName = teamData.teamName || roadmap.fileName;
                teamInfoMap[teamName] = {
                    teamName: teamName,
                    directorVP: teamData.directorVP || '',
                    em: teamData.em || '',
                    pm: teamData.pm || '',
                    description: teamData.description || '',
                    fileName: roadmap.fileName || ''
                };
            }
            
            return teamInfoMap;
        }
        
        /**
         * Display search results using roadmap format
         */
        function displaySearchResults(stories, searchQuery, searchRange = null, teamInfoMap = null) {
            try {
                // Only reset search force text below checkbox for new searches (not regenerations)
                if (searchQuery !== lastSearchQuery) {
                    const searchToggle = document.getElementById('search-force-text-below-toggle');
                    if (searchToggle) {
                        searchToggle.checked = false;
                        searchTempForceTextBelow = false;
                        window.searchTempForceTextBelow = false;
                    }
                }

                // Update lastSearchQuery for next comparison
                lastSearchQuery = searchQuery;
                lastSearchRange = searchRange;
                
                // Sort stories by dates in ascending order (oldest first)  
                stories.sort((a, b) => {
                    // Use consistent year for all stories - roadmap year if available, otherwise current year
                    const roadmapYear = stories.length > 0 && stories[0].roadmapYear 
                        ? stories[0].roadmapYear 
                        : new Date().getFullYear();
                    
                    const aStartDate = IMOUtility.parseStoryDate(a.startDate || a.startMonth || '', roadmapYear);
                    const aEndDate = IMOUtility.parseStoryDate(a.endDate || a.endMonth || '', roadmapYear);
                    const bStartDate = IMOUtility.parseStoryDate(b.startDate || b.startMonth || '', roadmapYear);
                    const bEndDate = IMOUtility.parseStoryDate(b.endDate || b.endMonth || '', roadmapYear);
                    
                    // If both have start dates, sort by start date first
                    if (aStartDate && bStartDate) {
                        const startComparison = aStartDate - bStartDate;
                        if (startComparison !== 0) {
                            return startComparison; // Different start dates
                        }
                        // Same start dates - sort by end date (ascending)
                        if (aEndDate && bEndDate) {
                            return aEndDate - bEndDate;
                        }
                        // One has end date, one doesn't
                        if (aEndDate && !bEndDate) return -1; // a comes first
                        if (!aEndDate && bEndDate) return 1;  // b comes first
                        return 0; // Both have same start, no end dates
                    }
                    
                    // Fallback: use primary date (start date or end date)
                    const aPrimaryDate = aStartDate || aEndDate;
                    const bPrimaryDate = bStartDate || bEndDate;
                    
                    // Handle null dates (put them at the end)
                    if (!aPrimaryDate && !bPrimaryDate) return 0;
                    if (!aPrimaryDate) return 1;
                    if (!bPrimaryDate) return -1;
                    
                    return aPrimaryDate - bPrimaryDate; // Ascending order
                });
                
                // Transform stories into roadmap format
                const crossTeamData = IMOViewGenerator.transformStoriesToRoadmapData(stories, searchQuery, searchRange, loadTeamOrder());
                // Swimlane order, which the tooltips and drag handles match by index
                const orderedTeamNames = crossTeamData.epics.map((epic) => epic.name);
                lastOrderedTeamNames = orderedTeamNames;
                
                // Generate roadmap HTML - use embedded mode but extract content only
                const generator = new RoadmapGenerator(crossTeamData.roadmapYear);
                const epicTitleTop = ConfigUtility.shouldShowEpicTitleTop();
                const hideStoryText = ConfigUtility.shouldHideStoryText();
                generator.displayOptions = { epicTitleTop, hideStoryText };
                const fullRoadmapHtml = generator.generateRoadmap(crossTeamData, true, false); // embedded=true, enableEditing=false
                
                // Extract just the content without the wrapper and embedded CSS
                const contentMatch = fullRoadmapHtml.match(/<div class="roadmap-wrapper">[^>]*<link[^>]*>(.*)<\/div>/s);
                const roadmapHtml = contentMatch ? contentMatch[1] : fullRoadmapHtml;
                
                // Clean up the HTML (remove BTL sections, etc.)
                const cleanedHtml = cleanRoadmapHtml(roadmapHtml);
                
                // Build team names with tooltips
                const teamNamesHtml = orderedTeamNames.map(teamName => {
                    const teamInfo = teamInfoMap && teamInfoMap[teamName];
                    if (teamInfo) {
                        const tooltipParts = [];
                        tooltipParts.push(`Team: ${teamName}`);
                        if (teamInfo.directorVP) tooltipParts.push(`Director/VP: ${teamInfo.directorVP}`);
                        if (teamInfo.em) tooltipParts.push(`EM: ${teamInfo.em}`);
                        if (teamInfo.pm) tooltipParts.push(`PM: ${teamInfo.pm}`);
                        if (teamInfo.description) tooltipParts.push(`Description: ${teamInfo.description}`);
                        if (teamInfo.fileName) tooltipParts.push(`File: ${teamInfo.fileName}`);
                        const tooltipText = tooltipParts.join('\n');
                        return `<span class="team-name-tooltip" data-tooltip="${tooltipText.replace(/"/g, '&quot;')}">${teamName}</span>`;
                    }
                    return teamName;
                }).join(', ');
                
                // Display in results container with an inline Stats button above the roadmap
                const contentArea = document.getElementById('contentArea');
                const queryLabelSafe = (searchQuery || '').toString();
                contentArea.innerHTML = `
                    <div class="results-container">
                        <div class="search-results-header">
                            <h2>Search results</h2>
                            <div class="search-summary">
                                Found <strong>${stories.length}</strong> ${stories.length === 1 ? 'story' : 'stories'} 
                                across <strong>${new Set(stories.map(s => s.teamName)).size}</strong> ${new Set(stories.map(s => s.teamName)).size === 1 ? 'team' : 'teams'} 
                                for "<strong>${queryLabelSafe}</strong>": (${teamNamesHtml})
                                ${orderedTeamNames.length > 1 ? `<button type="button" class="reorder-teams-link" id="reorderTeamsLink" onclick="toggleTeamOrderPopover()" aria-haspopup="dialog" aria-expanded="false">⠿ Reorder teams</button>` : ''}
                            </div>
                            <div class="search-results-header-options">
                                <label class="search-results-option">
                                    <input type="checkbox" id="search-force-text-below-toggle" onchange="handleSearchForceTextBelowToggle()" ${searchTempForceTextBelow ? 'checked' : ''}>
                                    Force all text boxes below stories
                                </label>
                                <label class="search-results-option">
                                    <input type="checkbox" id="search-epic-title-top-toggle" onchange="handleSearchEpicTitleTopToggle()" ${epicTitleTop ? 'checked' : ''}>
                                    Show epic titles at the top of each epic
                                </label>
                                <label class="search-results-option">
                                    <input type="checkbox" id="search-hide-story-text-toggle" onchange="handleSearchHideStoryTextToggle()" ${hideStoryText ? 'checked' : ''}>
                                    Show only story titles (text on hover)
                                </label>
                            </div>
                        </div>
                        <div class="search-roadmap">
                            ${cleanedHtml}
                        </div>
                    </div>
                `;
                
                // Add click handlers to story items after rendering
                setTimeout(() => {
                    addStoryClickHandlers(stories);
                    insertStatsButtonNearHeader();
                    attachTeamLabelTooltips(contentArea, orderedTeamNames, teamInfoMap);
                    if (teamOrderPopover) {
                        document.getElementById('reorderTeamsLink')?.setAttribute('aria-expanded', 'true');
                        // A new search can bring a different set of teams.
                        const listed = Array.from(teamOrderPopover.querySelectorAll('.team-order-item'))
                            .map((li) => li.dataset.team);
                        if (listed.join('\n') !== orderedTeamNames.join('\n')) renderTeamOrderList();
                        positionTeamOrderPopover();
                    }
                }, 100);
                
            } catch (error) {
                
                showMessage('Error displaying results: ' + error.message, 'error');
            }
        }

        // Insert Stats button inside the search results header
        function insertStatsButtonNearHeader() {
            try {
                const container = document.querySelector('.results-container');
                if (!container) return;
                
                // Avoid duplicates
                if (container.querySelector('#inlineSearchStatsBtn')) return;
                
                // Look for the search results header instead of the old roadmap header
                const headerEl = container.querySelector('.search-results-header');
                if (!headerEl) {
                    // If no search results header found, don't add the button
                    return;
                }
                
                const bar = document.createElement('div');
                bar.className = 'search-results-actions';
                bar.innerHTML = '<button id="inlineSearchStatsBtn" class="search-button secondary">Stats</button>';

                headerEl.appendChild(bar);
                
                const btn = bar.querySelector('#inlineSearchStatsBtn');
                if (btn) {
                    btn.addEventListener('click', openSearchStatsModal);
                }
            } catch {
                // Silent fail - stats button is optional
            }
        }
        
        /**
         * Clean roadmap HTML by removing unwanted sections
         */
        /**
         * Attach hover tooltips to the rotated team-name labels in the cross-team search roadmap.
         * Swimlane order matches the alphabetically-sorted team names produced by
         * transformStoriesToRoadmapData, so we can index into them directly.
         *
         * The tooltip is appended to document.body rather than rendered as a CSS
         * pseudo-element on the label, because .epic-label is rotated -90deg and
         * any descendant tooltip would inherit that rotation.
         */
        function attachTeamLabelTooltips(contentArea, sortedTeamNames, teamInfoMap) {
            if (!contentArea || !sortedTeamNames?.length) return;

            // Drop any orphaned tooltip from a previous render before wiring up new labels.
            document.querySelectorAll('.team-label-tooltip').forEach(el => el.remove());

            const swimlanes = contentArea.querySelectorAll(
                '.swimlane:not(.btl-swimlane):not(.special-swimlane)'
            );

            const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));

            const buildTooltipHtml = (teamName, info) => {
                const rows = [];
                if (info?.directorVP) rows.push(['Director / VP', info.directorVP, '🎯']);
                if (info?.em) rows.push(['Engineering Manager', info.em, '⚙️']);
                if (info?.pm) rows.push(['Product Manager', info.pm, '📋']);
                if (info?.fileName) rows.push(['File', info.fileName, '📄']);

                const rowHtml = rows.map(([label, value, icon]) => `
                    <div class="team-label-tooltip__row">
                        <div class="team-label-tooltip__row-icon">${icon}</div>
                        <div class="team-label-tooltip__row-text">
                            <div class="team-label-tooltip__label">${escapeHtml(label)}</div>
                            <div class="team-label-tooltip__value">${escapeHtml(value)}</div>
                        </div>
                    </div>
                `).join('');

                const descHtml = info?.description ? `
                    <div class="team-label-tooltip__description">
                        <div class="team-label-tooltip__label">About</div>
                        <div class="team-label-tooltip__desc-text">${escapeHtml(info.description)}</div>
                    </div>
                ` : '';

                const emptyState = !rows.length && !info?.description
                    ? '<div class="team-label-tooltip__empty">No additional team details</div>'
                    : '';

                return `
                    <div class="team-label-tooltip__header">
                        <div class="team-label-tooltip__header-icon">👥</div>
                        <div class="team-label-tooltip__header-text">${escapeHtml(teamName)}</div>
                    </div>
                    <div class="team-label-tooltip__body">
                        ${rowHtml}
                        ${descHtml}
                        ${emptyState}
                    </div>
                `;
            };

            let activeTooltip = null;
            const removeTooltip = () => {
                if (activeTooltip) {
                    activeTooltip.remove();
                    activeTooltip = null;
                }
            };

            // Position tooltip relative to cursor: prefer bottom-right of pointer,
            // flip horizontally / vertically when it would overflow the viewport.
            const positionTooltipAtCursor = (tooltip, mouseX, mouseY) => {
                const tipRect = tooltip.getBoundingClientRect();
                const offset = 16;
                const pad = 8;

                let left = mouseX + offset;
                if (left + tipRect.width > window.innerWidth - pad) {
                    left = mouseX - tipRect.width - offset;
                }
                if (left < pad) left = pad;

                let top = mouseY + offset;
                if (top + tipRect.height > window.innerHeight - pad) {
                    top = mouseY - tipRect.height - offset;
                }
                if (top < pad) top = pad;

                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${top}px`;
            };

            const showTooltip = (teamName, mouseX, mouseY) => {
                removeTooltip();
                const tooltip = document.createElement('div');
                tooltip.className = 'team-label-tooltip';
                tooltip.innerHTML = buildTooltipHtml(teamName, teamInfoMap?.[teamName]);
                document.body.appendChild(tooltip);
                positionTooltipAtCursor(tooltip, mouseX, mouseY);
                requestAnimationFrame(() => tooltip.classList.add('team-label-tooltip--visible'));
                activeTooltip = tooltip;
            };

            swimlanes.forEach((swimlane, index) => {
                const teamName = sortedTeamNames[index];
                if (!teamName) return;
                const label = swimlane.querySelector('.epic-label');
                if (!label) return;

                label.style.cursor = 'help';
                label.addEventListener('mouseenter', e => showTooltip(teamName, e.clientX, e.clientY));
                label.addEventListener('mousemove', e => {
                    if (activeTooltip) positionTooltipAtCursor(activeTooltip, e.clientX, e.clientY);
                });
                label.addEventListener('mouseleave', removeTooltip);
            });
        }

        function cleanRoadmapHtml(html) {
            let cleaned = html;
            
            // Remove BTL-related content
            cleaned = cleaned.replace(/<div class="swimlane-separator-dashed"><\/div>/g, '');
            cleaned = cleaned.replace(/Below the Line/g, '');
            
            // Remove ALL BTL-related swimlanes with various patterns
            cleaned = cleaned.replace(/<div class="swimlane btl-swimlane[^>]*>[\s\S]*?<\/div>/g, '');
            cleaned = cleaned.replace(/<div class="btl-swimlane[^>]*>[\s\S]*?<\/div>/g, '');
            
            // Remove any swimlane with min-height: 172px (BTL specific height)
            cleaned = cleaned.replace(/min-height:\s*172px;?/g, '');
            
            // Remove the roadmap header to avoid duplicate headers in search results.
            // It has nested divs, so a lazy regex would stop at the first inner
            // </div> and leave stray closing tags that end .search-roadmap early.
            const template = document.createElement('template');
            template.innerHTML = cleaned;
            template.content.querySelectorAll('.header').forEach((header) => header.remove());
            cleaned = template.innerHTML;
            
            // Remove any potential duplicate "Search Results" or similar headers
            cleaned = cleaned.replace(/<h[1-6][^>]*>.*?Search Results.*?<\/h[1-6]>/gi, '');
            cleaned = cleaned.replace(/<h[1-6][^>]*>.*?🔍.*?<\/h[1-6]>/gi, '');
            cleaned = cleaned.replace(/<h[1-6][^>]*>.*?Cross-Team.*?<\/h[1-6]>/gi, '');
            
            // Remove extra bottom padding/margins that cause white space
            cleaned = cleaned.replace(/margin-bottom:\s*[^;]+;?/g, '');
            cleaned = cleaned.replace(/padding-bottom:\s*[^;]+;?/g, '');
            cleaned = cleaned.replace(/<div[^>]*style="[^"]*margin-bottom[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
            
            return cleaned;
        }
        
        /**
         * Show loading state
         */
        function showLoadingState(message = 'Loading...') {
            const contentArea = document.getElementById('contentArea');
            contentArea.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <h3>${message}</h3>
                </div>
            `;
        }
        
        /**
         * Show message (info, warning, error)
         */
        function showMessage(message, type = 'info') {
            const contentArea = document.getElementById('contentArea');
            
            let icon = '📝';
            let state = 'info';
            
            if (type === 'warning') {
                icon = '⚠️';
                state = 'warning';
            } else if (type === 'error') {
                icon = '❌';
                state = 'error';
            }
            
            contentArea.innerHTML = `
                <div class="blank-state">
                    <div class="blank-state-icon">${icon}</div>
                    <h2 class="blank-state-title blank-state-title--${state}">${message}</h2>
                    <button onclick="showBlankState()" class="secondary">
                        Try Another Search
                    </button>
                </div>
            `;
        }
        
        /**
         * Show blank state
         */
        function showBlankState() {
            const contentArea = document.getElementById('contentArea');
            contentArea.innerHTML = `
                <div class="blank-state" id="blankState">
                    <div class="blank-state-icon">🔍</div>
                    <h2>Search across team roadmaps</h2>
                    <p>Find stories by owner, project, title, date, country, or status.</p>
                    <p class="blank-state-note">
                        Pick a folder from the top bar, then use any combination of filters.
                    </p>
                </div>
            `;
        }
        
        /**
         * Clear all results and return to blank state
         */
        function clearAllResults() {
            currentResults = [];
            lastRoadmapFiles = [];
            showBlankState();
            
            // Disable stats button
            document.getElementById('searchStatsBtn').disabled = true;
            
            // Clear search inputs
            document.getElementById('searchInput').value = '';
            document.getElementById('titleSearchInput').value = '';
            const priorityEl = document.getElementById('prioritySelect');
            if (priorityEl) priorityEl.value = '';
            const directorEl = document.getElementById('directorSearchInput');
            if (directorEl) directorEl.value = '';
            const directorVPIdEl = document.getElementById('directorVPIdSearchInput');
            if (directorVPIdEl) directorVPIdEl.value = '';
            clearCountryFlagCheckboxes();
            const productRoadmapEl = document.getElementById('filterProductRoadmapOnly');
            if (productRoadmapEl) productRoadmapEl.checked = false;
            
            // Clear date inputs
            const startEl = document.getElementById('startDateInput');
            if (startEl) {
                startEl.value = '';
                startEl.setAttribute('value', '');
            }
            const endEl = document.getElementById('endDateInput');
            if (endEl) {
                endEl.value = '';
                endEl.setAttribute('value', '');
            }
            
            // Reset search mode
            const modeEl = document.getElementById('searchModeSelect');
            if (modeEl) {
                modeEl.value = 'exact';
                updateSearchModeHelp();
            }
            
            // Clear status filter tri-state checkboxes
            Object.keys(statusFilterStates).forEach(filterId => {
                statusFilterStates[filterId] = 'none';
                const checkbox = document.getElementById(filterId);
                if (checkbox) {
                    checkbox.setAttribute('data-state', 'none');
                    checkbox.textContent = '';
                }
            });
            
            // Clear advanced expression
            const advancedExpr = document.getElementById('advancedFilterExpression');
            if (advancedExpr) advancedExpr.value = '';
            
            updateSearchButtonStates();
        }

        // Clear inputs and results from the top button
        function clearAllSearchFields() {
            clearAllResults();
        }
        
        /**
         * Navigate back to roadmap builder
         */
        function goToRoadmapBuilder() {
            if (window.__router) window.__router.navigate('/builder');
            else window.location.href = '/builder';
        }

        // Apply additional filters based on other filled inputs (AND semantics)
        function applyAdditionalFilters(stories, roadmapFiles, options = {}) {
            let result = Array.isArray(stories) ? stories.slice() : [];
            const opts = Object.assign({ skipDirector: false, skipDirectorVPId: false, skipCountryFlag: false, skipIMO: false, skipPriority: false, skipTitle: false, skipDate: false, skipStatus: false, skipProductRoadmap: false }, options);

            try {
                // Director/VP filter (team-level)
                const directorQuery = document.getElementById('directorSearchInput')?.value.trim();
                if (!opts.skipDirector && directorQuery) {
                    const matchingRoadmaps = IMOUtility.filterRoadmapsByDirector(roadmapFiles, directorQuery);
                    const allowedTeams = new Set(matchingRoadmaps.map(f => (f.teamData && f.teamData.teamName) || ''));
                    result = result.filter(story => allowedTeams.has(story.teamName));
                }

                // Director/VP ID filter (story-level, partial match)
                const directorVPIdQuery = document.getElementById('directorVPIdSearchInput')?.value.trim();
                if (!opts.skipDirectorVPId && directorVPIdQuery) {
                    const queryLower = directorVPIdQuery.toLowerCase();
                    result = result.filter(story =>
                        story.directorVPId && story.directorVPId.toLowerCase().includes(queryLower)
                    );
                }

                // Country flag filter (story-level, story must have at least one of the selected flags)
                const selectedCountries = getSelectedCountryFlags();
                if (!opts.skipCountryFlag && selectedCountries.length > 0) {
                    result = result.filter(story =>
                        Array.isArray(story.countryFlags) &&
                        selectedCountries.some(country => story.countryFlags.includes(country))
                    );
                }

                const imoQuery = document.getElementById('searchInput')?.value.trim();
                if (!opts.skipIMO && imoQuery) {
                    result = IMOUtility.filterStoriesByIMO(result, imoQuery);
                }

                // Priority filter - only include stories that also have an IMO,
                // mirroring the roadmap which hides the priority tag when IMO is empty.
                const priorityQuery = document.getElementById('prioritySelect')?.value;
                if (!opts.skipPriority && priorityQuery) {
                    const wanted = priorityQuery.toLowerCase();
                    result = result.filter(story => {
                        const hasIMO = Boolean((story.imo || '').toString().trim());
                        if (!hasIMO) return false;
                        return (story.priority || '').toLowerCase() === wanted;
                    });
                }

                // Title filter
                const titleQuery = document.getElementById('titleSearchInput')?.value.trim();
                if (!opts.skipTitle && titleQuery) {
                    result = IMOUtility.searchStoriesByTitle(result, titleQuery);
                }

                // Date filter
                const startDate = document.getElementById('startDateInput')?.value;
                const endDate = document.getElementById('endDateInput')?.value;
                const searchModeEl = document.getElementById('searchModeSelect');
                const searchMode = (searchModeEl && searchModeEl.value) ? searchModeEl.value : 'exact';
                if (!opts.skipDate && (startDate || endDate)) {
                    result = IMOUtility.searchStoriesByDateRange(result, startDate, endDate, searchMode);
                }

                // Status checkbox filter
                if (!opts.skipStatus) {
                    const filters = {
                        filterNew: statusFilterStates.filterNew,
                        filterDone: statusFilterStates.filterDone,
                        filterCancelled: statusFilterStates.filterCancelled,
                        filterAtRisk: statusFilterStates.filterAtRisk,
                        filterTimeline: statusFilterStates.filterTimeline,
                        filterProposed: statusFilterStates.filterProposed,
                        filterInfo: statusFilterStates.filterInfo,
                        filterTransferredIn: statusFilterStates.filterTransferredIn,
                        filterTransferredOut: statusFilterStates.filterTransferredOut
                    };

                    const hasIncludeFilters = Object.values(filters).some(state => state === 'include');
                    const hasExcludeFilters = Object.values(filters).some(state => state === 'exclude');

                    if (hasIncludeFilters || hasExcludeFilters) {
                        result = result.filter(story => {
                            const hasStatus = (filterKey) => {
                                switch(filterKey) {
                                    case 'filterNew': return story.isNewStory;
                                    case 'filterDone': return story.isDone;
                                    case 'filterCancelled': return story.isCancelled;
                                    case 'filterAtRisk': return story.isAtRisk;
                                    case 'filterTimeline': return story.roadmapChanges && story.roadmapChanges.changes && story.roadmapChanges.changes.length > 0;
                                    case 'filterProposed': return story.isProposed;
                                    case 'filterInfo': return story.isInfo;
                                    case 'filterTransferredIn': return story.isTransferredIn;
                                    case 'filterTransferredOut': return story.isTransferredOut;
                                    default: return false;
                                }
                            };

                            for (const [filterKey, state] of Object.entries(filters)) {
                                if (state === 'exclude' && hasStatus(filterKey)) return false;
                            }
                            if (!hasIncludeFilters) return true;
                            for (const [filterKey, state] of Object.entries(filters)) {
                                if (state === 'include' && hasStatus(filterKey)) return true;
                            }
                            return false;
                        });
                    }
                }
            } catch {}

            // Product Roadmap filter
            const productRoadmapOnly = document.getElementById('filterProductRoadmapOnly')?.checked;
            if (!opts.skipProductRoadmap && productRoadmapOnly) {
                result = result.filter(story => story.includeInProductRoadmap === true);
            }

            // Advanced expression filter - runs last so it applies on top of all other filters
            if (!opts.skipStatus) {
                const advancedExpression = document.getElementById('advancedFilterExpression')?.value.trim();
                if (advancedExpression) {
                    result = result.filter(story => {
                        const matches = evaluateFilterExpression(advancedExpression, story);
                        return matches === null ? true : matches;
                    });
                }
            }

            return result;
        }

        /**
         * Parse and evaluate a filter expression for a story
         * Supports: &&, ||, !, and ( ) with status names
         */
        function evaluateFilterExpression(expression, story) {
            if (!expression || !expression.trim()) return null;
            
            // Pre-process: remove newlines so multi-line input works as single expression
            let processedExpr = expression.replace(/[\r\n]+/g, ' ');
            
            // LEADERSHIP="name" - matches Director/VP, EM, or PM
            processedExpr = processedExpr.replace(/LEADERSHIP="([^"]+)"/gi, (match, name) => {
                const nameLower = name.toLowerCase();
                const directorVP = (story._directorVP || '').toLowerCase();
                const em = (story._em || '').toLowerCase();
                const pm = (story._pm || '').toLowerCase();
                const matches = directorVP.includes(nameLower) || em.includes(nameLower) || pm.includes(nameLower);
                return matches ? 'TRUE' : 'FALSE';
            });
            
            // CP="number" - matches CP number (IMO="..." kept as a legacy alias)
            processedExpr = processedExpr.replace(/\b(?:CP|IMO)="([^"]+)"/gi, (match, value) => {
                const imo = (story.imo || '').toLowerCase();
                return imo.includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
            });

            // PRIORITY="value" - matches priority value (exact, case-insensitive)
            processedExpr = processedExpr.replace(/PRIORITY="([^"]+)"/gi, (match, value) => {
                const priority = (story.priority || '').toLowerCase();
                return priority === value.toLowerCase() ? 'TRUE' : 'FALSE';
            });
            
            // TEAM="name" - matches team name
            processedExpr = processedExpr.replace(/TEAM="([^"]+)"/gi, (match, value) => {
                const teamName = (story.teamName || '').toLowerCase();
                return teamName.includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
            });
            
            // EPIC="name" - matches epic name
            processedExpr = processedExpr.replace(/EPIC="([^"]+)"/gi, (match, value) => {
                const epicName = (story.epicName || '').toLowerCase();
                return epicName.includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
            });
            
            // TITLE="text" - matches story title
            processedExpr = processedExpr.replace(/TITLE="([^"]+)"/gi, (match, value) => {
                const title = (story.title || '').toLowerCase();
                return title.includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
            });
            
            // VPID="id" - matches Director/VP ID field on story
            processedExpr = processedExpr.replace(/VPID="([^"]+)"/gi, (match, value) => {
                const vpId = (story.directorVPId || '').toLowerCase();
                return vpId.includes(value.toLowerCase()) ? 'TRUE' : 'FALSE';
            });
            
            // COUNTRY="name" - matches country flag
            processedExpr = processedExpr.replace(/COUNTRY="([^"]+)"/gi, (match, value) => {
                const flags = story.countryFlags || [];
                const valueLower = value.toLowerCase();
                const matches = flags.some(flag => flag.toLowerCase().includes(valueLower));
                return matches ? 'TRUE' : 'FALSE';
            });
            
            // Tokenize the expression
            const tokens = processedExpr
                .replace(/\(/g, ' ( ')
                .replace(/\)/g, ' ) ')
                .replace(/&&/g, ' && ')
                .replace(/\|\|/g, ' || ')
                .replace(/!/g, ' ! ')
                .split(/\s+/)
                .filter(t => t.length > 0);
            
            let pos = 0;
            
            // Recursive descent parser
            const parseExpression = () => parseOr();
            
            const parseOr = () => {
                let left = parseAnd();
                while (pos < tokens.length && tokens[pos] === '||') {
                    pos++; // consume ||
                    const right = parseAnd();
                    left = left || right;
                }
                return left;
            };
            
            const parseAnd = () => {
                let left = parseNot();
                while (pos < tokens.length && tokens[pos] === '&&') {
                    pos++; // consume &&
                    const right = parseNot();
                    left = left && right;
                }
                return left;
            };
            
            const parseNot = () => {
                if (pos < tokens.length && tokens[pos] === '!') {
                    pos++; // consume !
                    return !parsePrimary();
                }
                return parsePrimary();
            };
            
            const parsePrimary = () => {
                if (pos >= tokens.length) {
                    throw new Error('Unexpected end of expression');
                }
                
                const token = tokens[pos];
                
                // Handle parentheses
                if (token === '(') {
                    pos++; // consume (
                    const result = parseExpression();
                    if (pos >= tokens.length || tokens[pos] !== ')') {
                        throw new Error('Missing closing parenthesis');
                    }
                    pos++; // consume )
                    return result;
                }
                
                // Handle status names
                const storyPriority = (story.priority || '').toLowerCase();
                const storyImo = (story.imo || '').toString().trim().toLowerCase();
                const hasCP = storyImo.startsWith('cp');
                const hasIMO = storyImo.startsWith('imo');
                const hasPriority = storyPriority.length > 0;
                const statusMap = {
                    'Done': story.isDone,
                    'Cancelled': story.isCancelled,
                    'Timeline': story.roadmapChanges && story.roadmapChanges.changes && story.roadmapChanges.changes.length > 0,
                    'New': story.isNewStory,
                    'AtRisk': story.isAtRisk,
                    'Proposed': story.isProposed,
                    'Info': story.isInfo,
                    'TransferredIn': story.isTransferredIn,
                    'TransferredOut': story.isTransferredOut,
                    // Field presence tokens
                    'CP': hasCP,
                    'IMO': hasIMO,
                    'Priority': hasPriority,
                    // Priority value tokens (case-insensitive)
                    'High': storyPriority === 'high',
                    'Medium': storyPriority === 'medium',
                    'Low': storyPriority === 'low',
                    // Special tokens for pre-processed LEADERSHIP expressions
                    'TRUE': true,
                    'FALSE': false
                };
                
                // Case-insensitive lookup
                const statusKey = Object.keys(statusMap).find(key => key.toLowerCase() === token.toLowerCase());

                if (statusKey !== undefined) {
                    pos++; // consume status name
                    return statusMap[statusKey] || false;
                }

                // Match whole tokens so CP/IMO prefixes inside quoted field values stay literal.
                if (/^(?:CP|IMO)[^\s!&|()"]+$/i.test(token)) {
                    pos++;
                    const prefix = token.replace(/\*$/, '').toLowerCase();
                    return storyImo.startsWith(prefix);
                }

                // Quarter tokens: Q1, Q2, Q3, Q4
                if (/^q[1-4]$/i.test(token)) {
                    pos++;
                    const endVal = (story.endDate || story.endMonth || '').toString();
                    const roadmapYear = story.roadmapYear || new Date().getFullYear();
                    const isoDate = IMOUtility.convertStoryDateToISO(endVal, roadmapYear);
                    if (isoDate) {
                        const month = parseInt(isoDate.split('-')[1]);
                        const quarter = month <= 3 ? 'q1' : month <= 6 ? 'q2' : month <= 9 ? 'q3' : 'q4';
                        return quarter === token.toLowerCase();
                    }
                    return IMOUtility.getQuarterFromDate(endVal.toLowerCase()) === token.toLowerCase();
                }

                // Month tokens: Jan, February, Mar, etc.
                const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/i;
                if (MONTH_RE.test(token)) {
                    pos++;
                    const endVal = (story.endDate || story.endMonth || '').toString().toLowerCase();
                    return endVal.includes(token.toLowerCase());
                }

                throw new Error(`Unknown status: ${token}`);
            };
            
            try {
                const result = parseExpression();
                if (pos < tokens.length) {
                    throw new Error(`Unexpected token: ${tokens[pos]}`);
                }
                return result;
            } catch (error) {
                console.error('Expression parse error:', error.message);
                return null; // Return null on error to indicate invalid expression
            }
        }

        /**
         * Cycle through tri-state checkbox: none → include (✓) → exclude (!) → none
         */
        function cycleFilterState(filterId, event) {
            event.preventDefault();
            event.stopPropagation();
            
            const checkbox = document.getElementById(filterId);
            const currentState = statusFilterStates[filterId];
            
            // Cycle: none → include → exclude → none
            if (currentState === 'none') {
                statusFilterStates[filterId] = 'include';
                checkbox.setAttribute('data-state', 'include');
                checkbox.textContent = '✓';
            } else if (currentState === 'include') {
                statusFilterStates[filterId] = 'exclude';
                checkbox.setAttribute('data-state', 'exclude');
                checkbox.textContent = '!';
            } else {
                statusFilterStates[filterId] = 'none';
                checkbox.setAttribute('data-state', 'none');
                checkbox.textContent = '';
            }

            updateSearchButtonStates();
            applyStatusFilters();
        }

        /**
         * Handle Enter key in advanced filter (Ctrl+Enter or Cmd+Enter to apply)
         */
        function handleAdvancedFilterKeyDown(event, input) {
            // Check for help on any Enter
            if (event.key === 'Enter' && input.value.toLowerCase().trim() === 'help') {
                event.preventDefault();
                input.value = '';
                showAdvancedFilterHelp();
                return;
            }
            // Enter (plain or with Ctrl/Cmd) applies the filter
            if (event.key === 'Enter') {
                event.preventDefault();
                applyStatusFilters();
            }
        }
        
        /**
         * Handle change in advanced filter (blur/tab)
         */
        function handleAdvancedFilterChange(input) {
            if (input.value.toLowerCase().trim() === 'help') {
                input.value = '';
                showAdvancedFilterHelp();
            } else {
                applyStatusFilters();
            }
        }
        
        /**
         * Show advanced filter help dialog
         */
        function showAdvancedFilterHelp() {
            const overlay = document.createElement('div');
            overlay.id = 'advancedFilterHelpModal';
            overlay.className = 'modal';
            
            const modal = document.createElement('div');
            modal.className = 'modal-content advanced-filter-help-modal';
            
            modal.innerHTML = `
                <div class="modal-header">
                    <h3>Advanced Filter Options</h3>
                    <span class="close" onclick="document.getElementById('advancedFilterHelpModal').remove()">&times;</span>
                </div>
                <div class="modal-body advanced-filter-help-body">
                    <div class="advanced-filter-help-section">
                        <strong>OPERATORS:</strong><br>
                        <code>&&</code> AND &nbsp;&nbsp; <code>||</code> OR &nbsp;&nbsp; <code>!</code> NOT &nbsp;&nbsp; <code>( )</code> Grouping
                    </div>
                    <div class="advanced-filter-help-section">
                        <strong>STATUS FLAGS:</strong><br>
                        <code>Done</code> <code>Cancelled</code> <code>Timeline</code> <code>New</code> <code>AtRisk</code><br>
                        <code>Proposed</code> <code>Info</code> <code>TransferredIn</code> <code>TransferredOut</code>
                    </div>
                    <div class="advanced-filter-help-section">
                        <strong>FIELD PRESENCE:</strong><br>
                        <code>CP</code> - CP is filled &nbsp;&nbsp; <code>!CP</code> - CP is empty<br>
                        <code>Priority</code> - Priority is set &nbsp;&nbsp; <code>!Priority</code> - Priority is empty
                    </div>
                    <div class="advanced-filter-help-section">
                        <strong>PRIORITY VALUES:</strong><br>
                        <code>High</code> <code>Medium</code> <code>Low</code> (case-insensitive)
                    </div>
                    <div class="advanced-filter-help-section">
                        <strong>FIELD FILTERS (partial match unless noted):</strong><br>
                        <code>CP="0043"</code> - CP number (partial)<br>
                        <code>CP1</code> or <code>CP1*</code> - CP starts with CP1<br>
                        <code>PRIORITY="High"</code> - Priority (exact)<br>
                        <code>TEAM="Terminal"</code> - Team name<br>
                        <code>EPIC="Core"</code> - Epic name<br>
                        <code>TITLE="migration"</code> - Story title<br>
                        <code>VPID="Paulo"</code> - Director/VP ID on story<br>
                        <code>COUNTRY="UK"</code> - Country flag<br>
                        <code>LEADERSHIP="John"</code> - Director/VP, EM, or PM
                    </div>
                    <div>
                        <strong>EXAMPLES:</strong><br>
                        <code>Done && !Timeline</code><br>
                        <code>TEAM="Terminal" && Done</code><br>
                        <code>CP="0043" || CP="0044"</code><br>
                        <code>CP* && !CP2*</code> - CP IDs excluding those starting with CP2<br>
                        <code>(TEAM="A" || TEAM="B") && !Cancelled</code><br>
                        <code>COUNTRY="UK" && LEADERSHIP="John"</code><br>
                        <code>!CP</code> - stories without CP<br>
                        <code>High && !Done</code> - High priority, not done<br>
                        <code>!CP && Priority</code> - no CP but has priority
                    </div>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.remove();
            });
            
            // Close on Escape key
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        }

        /**
         * Apply status filters to current search results
         */
        async function applyStatusFilters() {
            try {
                // Scan the directory on first use so the advanced filter can run
                // without requiring a prior search. `lastRoadmapFiles` is
                // initialised to [] elsewhere, so check length too.
                if (!lastRoadmapFiles || !lastRoadmapFiles.length) {
                    if (!selectedDirectory) {
                        showMessage('Please select a directory first', 'warning');
                        return;
                    }
                    showLoadingState('Loading stories...');
                    const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                    if (!roadmapFiles.length) {
                        showMessage('No roadmap JSON files found in the selected directory', 'warning');
                        return;
                    }
                    lastRoadmapFiles = roadmapFiles;
                }

                // Re-aggregate from the scanned files so the filter runs against the
                // full dataset, not just the previous search's narrow result set.
                // applyAdditionalFilters still respects any search inputs that are
                // currently filled (IMO, priority, title, dates, etc.).
                const allStories = IMOUtility.aggregateStoriesAcrossTeams(lastRoadmapFiles, builderRoadmapYear);
                const filteredStories = applyAdditionalFilters(allStories, lastRoadmapFiles, {});

                // Get the current search parameters to determine which range to use
                const startDate = document.getElementById('startDateInput')?.value;
                const endDate = document.getElementById('endDateInput')?.value;
                const searchModeEl = document.getElementById('searchModeSelect');
                const searchMode = (searchModeEl && searchModeEl.value) ? searchModeEl.value : 'exact';

                // Create search range info if dates exist
                let searchRange = null;
                if (startDate || endDate) {
                    searchRange = {
                        startDate: startDate || 'N/A',
                        endDate: endDate || 'N/A',
                        mode: searchMode
                    };
                }

                if (!filteredStories.length) {
                    showMessage('No stories match the current filters', 'info');
                    currentResults = [];
                    return;
                }

                // Display the filtered results
                const teamInfoMap = buildTeamInfoMap(lastRoadmapFiles);
                displaySearchResults(filteredStories, 'Filtered Results', searchRange, teamInfoMap);
                currentResults = filteredStories;
                document.getElementById('searchStatsBtn').disabled = false;
            } catch (e) {
                console.error('Error applying status filters:', e);
                showMessage('Error applying filters: ' + e.message, 'error');
            }
        }

        /**
         * Handle date range picker change
         */
        /**
         * Set date range to roadmap year (01/01 to 31/12)
         */
        function setCurrentYearRange() {
            const year = builderRoadmapYear || new Date().getFullYear();
            const startDateInput = document.getElementById('startDateInput');
            const endDateInput = document.getElementById('endDateInput');
            
            // Set to ISO format for date inputs (YYYY-MM-DD)
            startDateInput.value = `${year}-01-01`;
            endDateInput.value = `${year}-12-31`;
            
            // Enable the search button
            updateSearchButtonStates();
        }
        
        function handleDateRangeChange() {
            updateSearchButtonStates();
        }

        /**
         * Returns true if any search filter has a value set.
         */
        function hasAnyFilterSet() {
            const hasImoInput = document.getElementById('searchInput')?.value.trim().length > 0;
            const hasTitleInput = document.getElementById('titleSearchInput')?.value.trim().length > 0;
            const hasDirectorVPIdInput = document.getElementById('directorVPIdSearchInput')?.value.trim().length > 0;
            const hasCountryFlagInput = getSelectedCountryFlags().length > 0;
            const hasPriorityInput = (document.getElementById('prioritySelect')?.value || '').length > 0;
            const hasStartDate = document.getElementById('startDateInput')?.value.length > 0;
            const hasEndDate = document.getElementById('endDateInput')?.value.length > 0;
            const hasStatusFilter = Object.values(statusFilterStates).some(s => s !== 'none');
            const hasAdvancedFilter = (document.getElementById('advancedFilterExpression')?.value.trim() || '').length > 0;
            const hasProductRoadmap = !!document.getElementById('filterProductRoadmapOnly')?.checked;
            return hasImoInput || hasTitleInput || hasDirectorVPIdInput || hasCountryFlagInput
                || hasPriorityInput || hasStartDate || hasEndDate
                || hasStatusFilter || hasAdvancedFilter || hasProductRoadmap;
        }

        /**
         * Update search button enabled state
         */
        function updateSearchButtonStates() {
            const combinedSearchBtn = document.getElementById('combinedSearchBtn');
            if (combinedSearchBtn) {
                combinedSearchBtn.disabled = !selectedDirectory || !hasAnyFilterSet();
            }
        }

        /**
         * Update search mode help text based on selected mode
         */
        function updateSearchModeHelp() {
            const searchMode = document.getElementById('searchModeSelect').value;
            const helpElement = document.getElementById('searchModeHelp');
            
            if (searchMode === 'exact') {
                helpElement.textContent = 'Exact: Stories must start/end exactly on the specified dates.';
            } else if (searchMode === 'exact-7days') {
                helpElement.textContent = 'Exact +/- 7 Days: Start date to +7 days forward only, end date +/- 7 days buffer.';
            } else if (searchMode === 'current-year') {
                const year = builderRoadmapYear || new Date().getFullYear();
                helpElement.textContent = `Roadmap Year: Searches all stories in ${year} (auto-fills 01/01/${year} to 31/12/${year}).`;
                // Auto-populate with roadmap year dates
                setCurrentYearRange();
            } else {
                helpElement.textContent = 'Range: Stories must start on or after start date AND end on or before end date.';
            }
        }

        /**
         * Build a human-readable label summarising every active filter.
         */
        function buildCombinedSearchLabel() {
            const parts = [];
            const imoQuery = document.getElementById('searchInput')?.value.trim();
            if (imoQuery) parts.push(`CP: "${imoQuery}"`);
            const priority = document.getElementById('prioritySelect')?.value;
            if (priority) parts.push(`Priority: ${priority}`);
            const titleQuery = document.getElementById('titleSearchInput')?.value.trim();
            if (titleQuery) parts.push(`Title: "${titleQuery}"`);
            const directorVPIdQuery = document.getElementById('directorVPIdSearchInput')?.value.trim();
            if (directorVPIdQuery) parts.push(`Director/VP ID: "${directorVPIdQuery}"`);
            const countries = getSelectedCountryFlags();
            if (countries.length) parts.push(`Countries: ${countries.join(', ')}`);
            const startDate = document.getElementById('startDateInput')?.value;
            const endDate = document.getElementById('endDateInput')?.value;
            const searchMode = document.getElementById('searchModeSelect')?.value || 'exact';
            if (startDate || endDate) {
                const modeLabel = searchMode === 'exact' ? 'Exact'
                    : searchMode === 'exact-7days' ? 'Exact +/- 7 Days'
                    : searchMode === 'current-year' ? 'Current Year'
                    : 'Range';
                if (startDate && endDate) parts.push(`${modeLabel}: ${startDate} to ${endDate}`);
                else if (startDate) parts.push(`${modeLabel} Start: ${startDate}`);
                else parts.push(`${modeLabel} End: ${endDate}`);
            }
            return parts.length ? parts.join(' + ') : 'All Stories';
        }

        /**
         * Single search entry point: applies every filled filter cumulatively (AND).
         */
        async function performCombinedSearch() {
            try {
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                    return;
                }
                if (!hasAnyFilterSet()) {
                    alert('Please enter at least one search criterion');
                    return;
                }

                const label = buildCombinedSearchLabel();
                showLoadingState(`Searching for ${label}...`);

                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                if (roadmapFiles.length === 0) {
                    showMessage('No roadmap JSON files found in the selected directory', 'warning');
                    return;
                }

                const allStories = IMOUtility.aggregateStoriesAcrossTeams(roadmapFiles, builderRoadmapYear);
                lastRoadmapFiles = roadmapFiles;

                const matchingStories = applyAdditionalFilters(allStories, roadmapFiles, {});

                // Build searchRange so the roadmap header can show the date filter
                const startDate = document.getElementById('startDateInput')?.value;
                const endDate = document.getElementById('endDateInput')?.value;
                const searchMode = document.getElementById('searchModeSelect')?.value || 'exact';
                const searchRange = (startDate || endDate)
                    ? { startDate: startDate || 'N/A', endDate: endDate || 'N/A', mode: searchMode }
                    : null;

                if (matchingStories.length === 0) {
                    showMessage(`No stories matched: ${label}`, 'info');
                    currentResults = [];
                    return;
                }

                currentResults = matchingStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(matchingStories, label, searchRange, teamInfoMap);

                document.getElementById('searchStatsBtn').disabled = false;
            } catch (error) {
                showMessage('Search error: ' + error.message, 'error');
            }
        }

        function handleCombinedSearchKeyPress(event) {
            if (event.key === 'Enter') {
                performCombinedSearch();
            }
        }

        /**
         * Perform date range search
         */
        async function performDateRangeSearch() {
            try {
                if (!selectedDirectory) {
                    showMessage('Please select a directory first', 'warning');
                    return;
                }
                
                const startDate = document.getElementById('startDateInput').value;
                const endDate = document.getElementById('endDateInput').value;
                const searchMode = document.getElementById('searchModeSelect').value;
                
                if (!startDate && !endDate) {
                    showMessage('Please select at least one date', 'warning');
                    return;
                }
                
                // Build search message
                let searchMessage = 'Searching for stories ';
                let queryLabel = '';
                let modeText;
                let modeLabel;
                
                if (searchMode === 'exact') {
                    modeText = 'exactly';
                    modeLabel = 'Exact';
                } else if (searchMode === 'exact-7days') {
                    modeText = 'with +/- 7 day buffer';
                    modeLabel = 'Exact +/- 7 Days';
                } else if (searchMode === 'current-year') {
                    modeText = 'in current year';
                    modeLabel = 'Current Year';
                } else {
                    modeText = 'in range';
                    modeLabel = 'Range';
                }
                
                if (startDate && endDate) {
                    searchMessage += `${modeText} between ${startDate} and ${endDate}...`;
                    queryLabel = `${modeLabel}: ${startDate} to ${endDate}`;
                } else if (startDate) {
                    searchMessage += `${modeText} starting ${startDate}...`;
                    queryLabel = `${modeLabel} Start: ${startDate}`;
                } else {
                    searchMessage += `${modeText} ending ${endDate}...`;
                    queryLabel = `${modeLabel} End: ${endDate}`;
                }
                
                showMessage(searchMessage, 'info');
                
                // Scan directory and search
                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                if (roadmapFiles.length === 0) {
                    showMessage('No roadmap JSON files found in the selected directory', 'warning');
                    return;
                }
                
                const allStories = IMOUtility.aggregateStoriesAcrossTeams(roadmapFiles, builderRoadmapYear);
                let matchingStories = IMOUtility.searchStoriesByDateRange(allStories, startDate, endDate, searchMode);
                
                lastRoadmapFiles = roadmapFiles;
                
                matchingStories = applyAdditionalFilters(matchingStories, roadmapFiles, { skipDate: true });
                
                if (matchingStories.length === 0) {
                    showMessage(`No stories found for the specified date range`, 'info');
                    return;
                }
                
                // Store results and display
                currentResults = matchingStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(matchingStories, queryLabel, { startDate, endDate }, teamInfoMap);
                
                // Enable header stats button
                document.getElementById('searchStatsBtn').disabled = false;
                
            } catch (error) {
                
                showMessage('Search error: ' + error.message, 'error');
            }
        }

        /**
         * Perform IMO search (renamed for clarity)
         */
        async function performIMOSearch() {
            await performSearch();
        }
        
        /**
         * Perform title search
         */
        async function performTitleSearch() {
            try {
                // Validate inputs
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                    return;
                }
                
                const searchQuery = document.getElementById('titleSearchInput').value.trim();
                if (!searchQuery) {
                    alert('Please enter a search query');
                    return;
                }
                
                // Show loading state
                showLoadingState(`Searching for stories with title containing "${searchQuery}"...`);
                
                // Scan directory for roadmap files
                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                
                if (roadmapFiles.length === 0) {
                    showMessage('No roadmap JSON files found in the selected directory', 'warning');
                    return;
                }
                
                // Extract and search stories by title
                const allStories = IMOUtility.aggregateStoriesAcrossTeams(roadmapFiles, builderRoadmapYear);
                
                let matchingStories = IMOUtility.searchStoriesByTitle(allStories, searchQuery);
                
                lastRoadmapFiles = roadmapFiles;
                
                matchingStories = applyAdditionalFilters(matchingStories, roadmapFiles, { skipTitle: true });
                
                if (matchingStories.length === 0) {
                    showMessage(`No stories found with title containing "${searchQuery}"`, 'info');
                    return;
                }
                
                // Store results and display
                currentResults = matchingStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(matchingStories, `Title: "${searchQuery}"`, null, teamInfoMap);
                
                // Enable stats button
                document.getElementById('searchStatsBtn').disabled = false;
                
            } catch (error) {
                
                showMessage('Search error: ' + error.message, 'error');
            }
        }
        
                function handleDirectorSearchKeyPress(event) {
            if (event.key === 'Enter') {
                performDirectorSearch();
            }
        }

        async function performDirectorSearch(leadershipName = null) {
            try {
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                    return;
                }

                // Use passed parameter or fall back to input field (for backwards compatibility)
                const query = leadershipName || document.getElementById('directorSearchInput')?.value?.trim();
                if (!query) {
                    alert('Please enter a leadership name (Director/VP, EM, or PM)');
                    return;
                }

                showLoadingState(`Searching roadmaps for leadership containing "${query}"...`);

                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                const matchingRoadmaps = IMOUtility.filterRoadmapsByDirector(roadmapFiles, query);

                if (!matchingRoadmaps.length) {
                    showMessage(`No roadmaps found for leadership containing "${query}"`, 'info');
                    return;
                }

                // Get all stories from the matching roadmaps
                const allStories = IMOUtility.aggregateStoriesAcrossTeams(matchingRoadmaps, builderRoadmapYear);
                
                lastRoadmapFiles = roadmapFiles;
                
                // Apply additional filters if other search fields are filled
                let filteredStories = allStories;
                filteredStories = applyAdditionalFilters(filteredStories, roadmapFiles, { skipDirector: true });

                if (!filteredStories.length) {
                    showMessage(`No stories found for leadership "${query}"`, 'info');
                    return;
                }

                currentResults = filteredStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(filteredStories, `Leadership: "${query}"`, null, teamInfoMap);
                
                // Enable stats button
                document.getElementById('searchStatsBtn').disabled = false;
            } catch (error) {
                
                showMessage('Search error: ' + error.message, 'error');
            }
        }

        function handleDirectorVPIdSearchKeyPress(event) {
            if (event.key === 'Enter') {
                performDirectorVPIdSearch();
            }
        }

        async function performDirectorVPIdSearch() {
            try {
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                    return;
                }

                const query = document.getElementById('directorVPIdSearchInput').value.trim();
                if (!query) {
                    alert('Please enter a Director/VP ID');
                    return;
                }

                showLoadingState(`Searching stories for Director/VP ID containing "${query}"...`);

                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                
                // Search through all stories for matching directorVPId
                const matchingStories = [];
                const queryLower = query.toLowerCase();
                
                for (const roadmap of roadmapFiles) {
                    // teamData is directly on the roadmap object from scanRoadmapDirectory
                    const teamData = roadmap.teamData;
                    if (!teamData || !teamData.epics) continue;
                    
                    const teamName = teamData.teamName || roadmap.fileName;
                    
                    for (const epic of teamData.epics) {
                        if (epic.stories) {
                            for (const story of epic.stories) {
                                if (story.directorVPId && story.directorVPId.toLowerCase().includes(queryLower)) {
                                    matchingStories.push({
                                        ...story,
                                        epicName: epic.name,
                                        teamName: teamName,
                                        fileName: roadmap.fileName
                                    });
                                }
                            }
                        }
                    }
                }

                if (!matchingStories.length) {
                    showMessage(`No stories found with Director/VP ID containing "${query}"`, 'info');
                    return;
                }

                lastRoadmapFiles = roadmapFiles;

                // Apply additional filters if other search fields are filled
                let filteredStories = matchingStories;
                filteredStories = applyAdditionalFilters(filteredStories, roadmapFiles, { skipDirectorVPId: true });

                if (!filteredStories.length) {
                    showMessage(`No stories found for Director/VP ID "${query}"`, 'info');
                    return;
                }

                currentResults = filteredStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(filteredStories, `Director/VP ID: "${query}"`, null, teamInfoMap);
                
                // Enable stats button
                document.getElementById('searchStatsBtn').disabled = false;
            } catch (error) {
                
                showMessage('Search error: ' + error.message, 'error');
            }
        }

        /**
         * Get all selected country flag checkboxes
         */
        function getSelectedCountryFlags() {
            const flags = [];
            if (document.getElementById('searchFlagGlobal')?.checked) flags.push('Global');
            if (document.getElementById('searchFlagCzechia')?.checked) flags.push('Czechia');
            if (document.getElementById('searchFlagHungary')?.checked) flags.push('Hungary');
            if (document.getElementById('searchFlagIceland')?.checked) flags.push('Iceland');
            if (document.getElementById('searchFlagItaly')?.checked) flags.push('Italy');
            if (document.getElementById('searchFlagPortugal')?.checked) flags.push('Portugal');
            if (document.getElementById('searchFlagSlovakia')?.checked) flags.push('Slovakia');
            if (document.getElementById('searchFlagSlovenia')?.checked) flags.push('Slovenia');
            if (document.getElementById('searchFlagCroatia')?.checked) flags.push('Croatia');
            if (document.getElementById('searchFlagSpain')?.checked) flags.push('Spain');
            if (document.getElementById('searchFlagUK')?.checked) flags.push('UK');
            if (document.getElementById('searchFlagGermany')?.checked) flags.push('Germany');
            if (document.getElementById('searchFlagFrance')?.checked) flags.push('France');
            return flags;
        }

        const SEARCH_FLAG_COUNTRY_IDS = [
            'searchFlagCzechia', 'searchFlagHungary', 'searchFlagIceland',
            'searchFlagItaly', 'searchFlagPortugal', 'searchFlagSlovakia',
            'searchFlagSlovenia', 'searchFlagCroatia', 'searchFlagSpain',
            'searchFlagUK', 'searchFlagGermany', 'searchFlagFrance',
        ];

        /**
         * Clear all country flag checkboxes
         */
        function clearCountryFlagCheckboxes() {
            const globalEl = document.getElementById('searchFlagGlobal');
            if (globalEl) globalEl.checked = false;
            SEARCH_FLAG_COUNTRY_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.checked = false;
            });
        }

        // Mutual exclusion: Global vs individual countries (matches builder semantics)
        function clearSearchGlobalIfCountrySelected() {
            const anyCountrySelected = SEARCH_FLAG_COUNTRY_IDS.some(id => document.getElementById(id)?.checked);
            if (anyCountrySelected) {
                const globalEl = document.getElementById('searchFlagGlobal');
                if (globalEl) globalEl.checked = false;
            }
        }

        function clearSearchCountriesIfGlobalSelected() {
            const globalEl = document.getElementById('searchFlagGlobal');
            if (!globalEl?.checked) return;
            SEARCH_FLAG_COUNTRY_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.checked = false;
            });
        }

        function handleSearchFlagChange(country) {
            if (country.code === 'global') {
                clearSearchCountriesIfGlobalSelected();
            } else {
                clearSearchGlobalIfCountrySelected();
            }
            updateSearchButtonStates();
        }

        async function performCountryFlagSearch() {
            try {
                if (!selectedDirectory) {
                    alert('Please select a directory first');
                    return;
                }

                const selectedCountries = getSelectedCountryFlags();
                if (selectedCountries.length === 0) {
                    alert('Please select at least one country');
                    return;
                }

                const countriesLabel = selectedCountries.join(', ');
                showLoadingState(`Searching stories for country flags: ${countriesLabel}...`);

                const roadmapFiles = await IMOUtility.scanRoadmapDirectory(selectedDirectory);
                
                // Search through all stories for matching country flags
                const matchingStories = [];
                
                for (const roadmap of roadmapFiles) {
                    const teamData = roadmap.teamData;
                    if (!teamData || !teamData.epics) continue;
                    
                    const teamName = teamData.teamName || roadmap.fileName;
                    
                    for (const epic of teamData.epics) {
                        if (epic.stories) {
                            for (const story of epic.stories) {
                                // Check if story has ANY of the selected country flags
                                if (story.countryFlags && Array.isArray(story.countryFlags)) {
                                    const hasMatchingFlag = selectedCountries.some(country => 
                                        story.countryFlags.includes(country)
                                    );
                                    if (hasMatchingFlag) {
                                        matchingStories.push({
                                            ...story,
                                            epicName: epic.name,
                                            teamName: teamName,
                                            fileName: roadmap.fileName
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                if (!matchingStories.length) {
                    showMessage(`No stories found with country flags: ${countriesLabel}`, 'info');
                    return;
                }

                lastRoadmapFiles = roadmapFiles;

                // Apply additional filters if other search fields are filled
                let filteredStories = matchingStories;
                filteredStories = applyAdditionalFilters(filteredStories, roadmapFiles, { skipCountryFlag: true });

                if (!filteredStories.length) {
                    showMessage(`No stories found for countries: ${countriesLabel}`, 'info');
                    return;
                }

                currentResults = filteredStories;
                const teamInfoMap = buildTeamInfoMap(roadmapFiles);
                displaySearchResults(filteredStories, `Countries: ${countriesLabel}`, null, teamInfoMap);
                
                // Enable stats button
                document.getElementById('searchStatsBtn').disabled = false;
            } catch (error) {
                
                showMessage('Search error: ' + error.message, 'error');
            }
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            // Populate the country-flags fieldsets once. Existing save/load
            // logic references the checkbox ids directly, so keep the id scheme
            // it expects (searchFlag<Name>, viewFlag<Name>).
            if (typeof renderCountryFlagsHTML === 'function') {
                const searchContainer = document.getElementById('searchFlagsContainer');
                if (searchContainer) {
                    searchContainer.innerHTML = renderCountryFlagsHTML({
                        id: c => `searchFlag${c.name}`,
                        onChange: c => c.code === 'global'
                            ? `handleSearchFlagChange({code:'global'})`
                            : `handleSearchFlagChange({code:'${c.code}'})`,
                        visuallyHiddenLegend: true
                    });
                }
                const viewContainer = document.getElementById('viewFlagsContainer');
                if (viewContainer) {
                    viewContainer.innerHTML = renderCountryFlagsHTML({
                        id: c => `viewFlag${c.name}`,
                        readOnly: true,
                        visuallyHiddenLegend: true
                    });
                }
            }

            // Add input listeners for real-time button state updates
            document.getElementById('searchInput').addEventListener('input', updateSearchButtonStates);
            document.getElementById('titleSearchInput').addEventListener('input', updateSearchButtonStates);
            document.getElementById('directorVPIdSearchInput').addEventListener('input', updateSearchButtonStates);
            if (document.getElementById('dateInput')) {
                document.getElementById('dateInput').addEventListener('change', updateSearchButtonStates);
            }
            if (document.getElementById('startDateInput')) {
                document.getElementById('startDateInput').addEventListener('change', updateSearchButtonStates);
            }
            if (document.getElementById('endDateInput')) {
                document.getElementById('endDateInput').addEventListener('change', updateSearchButtonStates);
            }
            if (document.getElementById('prioritySelect')) {
                document.getElementById('prioritySelect').addEventListener('change', updateSearchButtonStates);
            }
            if (document.getElementById('filterProductRoadmapOnly')) {
                document.getElementById('filterProductRoadmapOnly').addEventListener('change', updateSearchButtonStates);
            }
            if (document.getElementById('advancedFilterExpression')) {
                document.getElementById('advancedFilterExpression').addEventListener('input', updateSearchButtonStates);
            }
            
            // Focus on search input if directory is already selected
            if (selectedDirectory) {
                document.getElementById('searchInput').focus();
            }

            // Set initial state for all search controls
            updateSearchButtonStates();

            // Subscribe to the shared directory store. Picker/permission flow
            // is driven by the top nav - we just react to the current handle.
            //
            // The router never unsubscribes us when the user navigates away,
            // so this callback can fire while imo-search's DOM is unmounted
            // (e.g., user is on /builder and picks a folder via the nav).
            // The presence of the directoryStatus element is our liveness
            // signal: if it's gone, our view is unmounted and we bail.
            cleanupDirectorySubscription = directoryStore.subscribe(async (snap) => {
                    const dirStatus = document.getElementById('directoryStatus');
                    if (!dirStatus) return; // imo-search view is not mounted; ignore.

                    if (!snap.handle) {
                        selectedDirectory = null;
                        dirStatus.dataset.state = '';
                        dirStatus.textContent = 'No folder selected - pick one in the top bar';
                        updateSearchButtonStates();
                        return;
                    }
                    if (snap.permission !== 'granted') {
                        selectedDirectory = null;
                        dirStatus.dataset.state = 'warning';
                        dirStatus.textContent = `🔒 ${snap.name} is locked. Click Unlock in the top bar to grant access.`;
                        updateSearchButtonStates();
                        return;
                    }
                    // Cross-team search inherently scans many files. Single-file
                    // mode (the "Open a single file..." choice in the top nav)
                    // gives us a file handle, not a directory handle, so the
                    // scan would fail with "entries is not a function". Surface
                    // a clear message instead and tell the user to pick a folder.
                    if (snap.type === 'file') {
                        selectedDirectory = null;
                        dirStatus.dataset.state = 'warning';
                        dirStatus.textContent = `📄 ${snap.name} is a single file. Cross-team Search needs a folder - pick one via the top bar.`;
                        updateSearchButtonStates();
                        return;
                    }
                    if (selectedDirectory !== snap.handle) {
                        selectedDirectory = snap.handle;
                        await warmDirectoryCache({ refresh: true });
                        updateSearchButtonStates();
                    }
            });
        });
    
        // === END legacy script body ===

        // Inline event attributes resolve their handlers against window.
        if (typeof openSearchStatsModal === 'function') window.openSearchStatsModal = openSearchStatsModal;
if (typeof closeSearchStatsModal === 'function') window.closeSearchStatsModal = closeSearchStatsModal;
if (typeof computeSearchStats === 'function') window.computeSearchStats = computeSearchStats;
if (typeof renderSearchStatsHtml === 'function') window.renderSearchStatsHtml = renderSearchStatsHtml;
if (typeof barChart === 'function') window.barChart = barChart;
if (typeof getDelayBreakdown === 'function') window.getDelayBreakdown = getDelayBreakdown;
if (typeof setupSearchTooltips === 'function') window.setupSearchTooltips = setupSearchTooltips;
if (typeof toggleSearchDelayBreakdown === 'function') window.toggleSearchDelayBreakdown = toggleSearchDelayBreakdown;
if (typeof renderSearchOntimeBreakdown === 'function') window.renderSearchOntimeBreakdown = renderSearchOntimeBreakdown;
if (typeof renderSearchAcceleratedBreakdown === 'function') window.renderSearchAcceleratedBreakdown = renderSearchAcceleratedBreakdown;
if (typeof renderSearchDelayBreakdown === 'function') window.renderSearchDelayBreakdown = renderSearchDelayBreakdown;
if (typeof renderSearchDelaySubBreakdown === 'function') window.renderSearchDelaySubBreakdown = renderSearchDelaySubBreakdown;
if (typeof compareByTeamThenTitle === 'function') window.compareByTeamThenTitle = compareByTeamThenTitle;
if (typeof renderSearchDelayDetails === 'function') window.renderSearchDelayDetails = renderSearchDelayDetails;
if (typeof renderSearchCancelledBreakdown === 'function') window.renderSearchCancelledBreakdown = renderSearchCancelledBreakdown;
if (typeof setupSearchDelayBreakdownInteractions === 'function') window.setupSearchDelayBreakdownInteractions = setupSearchDelayBreakdownInteractions;
if (typeof openStoryDetailsModal === 'function') window.openStoryDetailsModal = openStoryDetailsModal;
if (typeof populateCheckboxes === 'function') window.populateCheckboxes = populateCheckboxes;
if (typeof populateKTLOMonthlyData === 'function') window.populateKTLOMonthlyData = populateKTLOMonthlyData;
if (typeof populateStatusFields === 'function') window.populateStatusFields = populateStatusFields;
if (typeof populateTimelineChanges === 'function') window.populateTimelineChanges = populateTimelineChanges;
if (typeof closeStoryDetailsModal === 'function') window.closeStoryDetailsModal = closeStoryDetailsModal;
if (typeof addStoryClickHandlers === 'function') window.addStoryClickHandlers = addStoryClickHandlers;
if (typeof findStoryData === 'function') window.findStoryData = findStoryData;
if (typeof selectDirectory === 'function') window.selectDirectory = selectDirectory;
if (typeof warmDirectoryCache === 'function') window.warmDirectoryCache = warmDirectoryCache;
if (typeof showDirectoryPickerUnsupported === 'function') window.showDirectoryPickerUnsupported = showDirectoryPickerUnsupported;
if (typeof handleSearchKeyPress === 'function') window.handleSearchKeyPress = handleSearchKeyPress;
if (typeof handleTitleSearchKeyPress === 'function') window.handleTitleSearchKeyPress = handleTitleSearchKeyPress;
if (typeof performSearch === 'function') window.performSearch = performSearch;
if (typeof handleSearchForceTextBelowToggle === 'function') window.handleSearchForceTextBelowToggle = handleSearchForceTextBelowToggle;
window.handleSearchEpicTitleTopToggle = handleSearchEpicTitleTopToggle;
window.handleSearchHideStoryTextToggle = handleSearchHideStoryTextToggle;
window.toggleTeamOrderPopover = toggleTeamOrderPopover;
if (typeof displaySearchResults === 'function') window.displaySearchResults = displaySearchResults;
if (typeof insertStatsButtonNearHeader === 'function') window.insertStatsButtonNearHeader = insertStatsButtonNearHeader;
if (typeof cleanRoadmapHtml === 'function') window.cleanRoadmapHtml = cleanRoadmapHtml;
if (typeof showLoadingState === 'function') window.showLoadingState = showLoadingState;
if (typeof showMessage === 'function') window.showMessage = showMessage;
if (typeof showBlankState === 'function') window.showBlankState = showBlankState;
if (typeof clearAllResults === 'function') window.clearAllResults = clearAllResults;
if (typeof clearAllSearchFields === 'function') window.clearAllSearchFields = clearAllSearchFields;
if (typeof goToRoadmapBuilder === 'function') window.goToRoadmapBuilder = goToRoadmapBuilder;
if (typeof applyAdditionalFilters === 'function') window.applyAdditionalFilters = applyAdditionalFilters;
if (typeof evaluateFilterExpression === 'function') window.evaluateFilterExpression = evaluateFilterExpression;
if (typeof cycleFilterState === 'function') window.cycleFilterState = cycleFilterState;
if (typeof handleAdvancedFilterKeyDown === 'function') window.handleAdvancedFilterKeyDown = handleAdvancedFilterKeyDown;
if (typeof handleAdvancedFilterChange === 'function') window.handleAdvancedFilterChange = handleAdvancedFilterChange;
if (typeof showAdvancedFilterHelp === 'function') window.showAdvancedFilterHelp = showAdvancedFilterHelp;
if (typeof applyStatusFilters === 'function') window.applyStatusFilters = applyStatusFilters;
if (typeof setCurrentYearRange === 'function') window.setCurrentYearRange = setCurrentYearRange;
if (typeof handleDateRangeChange === 'function') window.handleDateRangeChange = handleDateRangeChange;
if (typeof updateSearchButtonStates === 'function') window.updateSearchButtonStates = updateSearchButtonStates;
if (typeof updateSearchModeHelp === 'function') window.updateSearchModeHelp = updateSearchModeHelp;
if (typeof performDateRangeSearch === 'function') window.performDateRangeSearch = performDateRangeSearch;
if (typeof performIMOSearch === 'function') window.performIMOSearch = performIMOSearch;
if (typeof performTitleSearch === 'function') window.performTitleSearch = performTitleSearch;
if (typeof performCombinedSearch === 'function') window.performCombinedSearch = performCombinedSearch;
if (typeof handleCombinedSearchKeyPress === 'function') window.handleCombinedSearchKeyPress = handleCombinedSearchKeyPress;
if (typeof hasAnyFilterSet === 'function') window.hasAnyFilterSet = hasAnyFilterSet;
if (typeof buildCombinedSearchLabel === 'function') window.buildCombinedSearchLabel = buildCombinedSearchLabel;
if (typeof handleDirectorSearchKeyPress === 'function') window.handleDirectorSearchKeyPress = handleDirectorSearchKeyPress;
if (typeof performDirectorSearch === 'function') window.performDirectorSearch = performDirectorSearch;
if (typeof handleDirectorVPIdSearchKeyPress === 'function') window.handleDirectorVPIdSearchKeyPress = handleDirectorVPIdSearchKeyPress;
if (typeof performDirectorVPIdSearch === 'function') window.performDirectorVPIdSearch = performDirectorVPIdSearch;
if (typeof getSelectedCountryFlags === 'function') window.getSelectedCountryFlags = getSelectedCountryFlags;
if (typeof clearCountryFlagCheckboxes === 'function') window.clearCountryFlagCheckboxes = clearCountryFlagCheckboxes;
if (typeof handleSearchFlagChange === 'function') window.handleSearchFlagChange = handleSearchFlagChange;
if (typeof clearSearchGlobalIfCountrySelected === 'function') window.clearSearchGlobalIfCountrySelected = clearSearchGlobalIfCountrySelected;
if (typeof clearSearchCountriesIfGlobalSelected === 'function') window.clearSearchCountriesIfGlobalSelected = clearSearchCountriesIfGlobalSelected;
if (typeof performCountryFlagSearch === 'function') window.performCountryFlagSearch = performCountryFlagSearch;
    } finally {
        document.addEventListener = __origAdd;
    }
    for (const fn of __viewReady) {
        try { fn.call(document, new Event('DOMContentLoaded')); } catch (e) { console.error(e); }
    }
    return () => {
        cleanupDirectorySubscription();
        closeTeamOrderPopover();
    };
}
