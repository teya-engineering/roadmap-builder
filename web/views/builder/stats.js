import { DateUtility } from '../../utilities/date-utility.js';

// Roadmap stats modal: bar charts of on-time / delayed / accelerated /
// cancelled stories with click-to-expand drill-downs.
//
// computeRoadmapStats is pure - it walks teamData.epics and builds an
// aggregate object. Everything else renders against that object. The modal
// is opened by openStatsModal which collects the live form data first.
//
// Stats are stashed on window.__roadmapStats so the bar-chart click handlers
// (registered via setupTooltips after the modal renders) can reach them.

/**
 * @param {object} deps
 * @param {() => any} deps.collectFormData  Reads the live form into teamData.
 */
export function createStatsHandlers({ collectFormData }) {
    function openStatsModal() {
        try {
            const teamData = collectFormData();
            const stats = computeRoadmapStats(teamData);
            const body = document.getElementById('statsModalBody');
            body.innerHTML = renderStatsHtml(stats);
            const modal = document.getElementById('statsModal');
            modal.style.display = 'flex';
            // Tooltips and drill-down click handlers are bound to the rendered
            // bar charts; stash stats globally so the handlers can read them.
            window.__roadmapStats = stats;
            setTimeout(setupTooltips, 100);
        } catch {
            // Swallow stats failures - the user can still work without the modal.
        }
    }

    function closeStatsModal() {
        const modal = document.getElementById('statsModal');
        if (modal) modal.style.display = 'none';
    }

    function setupTooltips() {
        document.querySelectorAll('[data-tooltip]').forEach((el) => {
            el.removeEventListener('click', toggleDelayBreakdown);
            el.addEventListener('click', toggleDelayBreakdown);
        });
    }

    function toggleDelayBreakdown(e) {
        e.preventDefault();
        e.stopPropagation();

        const container = e.currentTarget || e.target.closest('[data-tooltip]');
        if (!container) return;

        const breakdownType = container.getAttribute('data-breakdown-type');
        if (!breakdownType) return;

        const breakdownId = `${breakdownType}-breakdown`;
        const existing = document.getElementById(breakdownId);
        const barChartContainer = container.classList.contains('bar-chart-container')
            ? container
            : container.closest('.bar-chart-container');
        const chevron = barChartContainer ? barChartContainer.querySelector('.expand-chevron') : null;

        if (existing) {
            existing.remove();
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            return;
        }
        if (chevron) chevron.style.transform = 'rotate(90deg)';

        const stats = window.__roadmapStats || { delayBreakdown: {}, delayStories: {}, totalStories: 0, cancelled: 0 };

        const breakdown = document.createElement('div');
        breakdown.id = breakdownId;
        breakdown.style.cssText = `
            margin-top: 10px;
            padding: 12px;
            background: #f8f9fa;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            font-size: 12px;
            color: #374151;
        `;

        if (breakdownType === 'delayed') {
            breakdown.innerHTML = renderDelayBreakdown(stats, stats.totalStories);
        } else if (breakdownType === 'ontime') {
            breakdown.innerHTML = renderOntimeBreakdown(stats, stats.totalStories);
        } else if (breakdownType === 'accelerated') {
            breakdown.innerHTML = renderAcceleratedBreakdown(stats, stats.totalStories);
        } else if (breakdownType === 'cancelled') {
            breakdown.innerHTML = renderCancelledBreakdown(stats);
        }

        container.parentNode.insertBefore(breakdown, container.nextSibling);
        setupDelayBreakdownInteractions();
    }

    // ----- Pure stats computation -----------------------------------------

    function computeRoadmapStats(teamData) {
        const result = {
            totalEpics: 0, totalStories: 0,
            onTime: 0, onTimeDone: 0, onTimeNotDone: 0,
            delayedOnce: 0, delayedTwiceOrMore: 0,
            accelerated: 0, cancelled: 0, totalDelayed: 0,
            delayBreakdown: {},
            delayStories: {},
            acceleratedStories: { done: [], notDone: [] },
            onTimeStories: { done: [], notDone: [] },
            cancelledStories: [],
        };
        if (!teamData || !Array.isArray(teamData.epics)) return result;

        result.totalEpics = teamData.epics.length;
        const teamName = (teamData && teamData.teamName) || '';
        const roadmapYear = teamData.roadmapYear || new Date().getFullYear();

        for (const epic of teamData.epics) {
            if (!Array.isArray(epic.stories)) continue;
            for (const story of epic.stories) {
                result.totalStories++;
                if (story.isCancelled) {
                    result.cancelled++;
                    result.cancelledStories.push({ title: story.title, epicName: epic.name, teamName });
                    continue;
                }

                // Walk the story's recorded timeline changes and count actual
                // delays (newEndDate > prevEndDate) vs. accelerations (the
                // reverse). Pairs without a clear direction are ignored.
                let actualDelayCount = 0;
                let hasAcceleration = false;
                const changes = story.roadmapChanges?.changes || [];
                for (const change of changes) {
                    if (!change.prevEndDate || !change.newEndDate) continue;
                    const prevISO = DateUtility.parseTextValue(change.prevEndDate, true, roadmapYear);
                    const newISO = DateUtility.parseTextValue(change.newEndDate, true, roadmapYear);
                    if (!prevISO || !newISO) continue;
                    if (newISO > prevISO) actualDelayCount++;
                    else if (newISO < prevISO) hasAcceleration = true;
                }

                if (actualDelayCount === 0 && !hasAcceleration) {
                    result.onTime++;
                    const bucket = story.isDone ? result.onTimeStories.done : result.onTimeStories.notDone;
                    bucket.push({ title: story.title, epicName: epic.name });
                    if (story.isDone) result.onTimeDone++;
                    else result.onTimeNotDone++;
                } else if (hasAcceleration && actualDelayCount === 0) {
                    result.accelerated++;
                    const bucket = story.isDone ? result.acceleratedStories.done : result.acceleratedStories.notDone;
                    bucket.push({ title: story.title, epicName: epic.name });
                } else if (actualDelayCount > 0) {
                    result.totalDelayed++;
                    if (actualDelayCount === 1) result.delayedOnce++;
                    else result.delayedTwiceOrMore++;

                    result.delayBreakdown[actualDelayCount] = (result.delayBreakdown[actualDelayCount] || 0) + 1;
                    if (!result.delayStories[actualDelayCount]) {
                        result.delayStories[actualDelayCount] = { done: [], notDone: [] };
                    }
                    const bucket = story.isDone
                        ? result.delayStories[actualDelayCount].done
                        : result.delayStories[actualDelayCount].notDone;
                    bucket.push({ title: story.title, epicName: epic.name });
                }
            }
        }
        return result;
    }

    function isDelayChange(change) {
        if (!change) return false;
        try {
            if (change.type && /delay|slip/i.test(change.type)) return true;
            if (change.description && /delay|slip|pushed/i.test(change.description)) return true;
            if (change.newEndDate && change.prevEndDate) {
                const n = Date.parse(change.newEndDate);
                const p = Date.parse(change.prevEndDate);
                if (!isNaN(n) && !isNaN(p) && n > p) return true;
            }
        } catch {}
        return false;
    }

    // ----- Rendering primitives -------------------------------------------

    function renderStatsHtml(s) {
        return (
            '<div style="padding: 20px;">' +
                '<h3 style="margin: 0 0 20px 0; color: #333; text-align: center;">📊 Project Status Overview</h3>' +
                '<div style="margin-bottom: 20px; text-align: center; font-size: 14px; color: #666;">' +
                    `${s.totalStories} Total Stories across ${s.totalEpics} EPICs` +
                '</div>' +
                '<div style="max-width: 600px; margin: 0 auto;">' +
                    barChart('On-time Projects', s.onTime, s.totalStories, '#28a745', s, 'ontime') +
                    barChart('Delayed Projects', s.totalDelayed, s.totalStories, '#dc3545', s, 'delayed') +
                    barChart('Accelerated Projects', s.accelerated, s.totalStories, '#17a2b8', s, 'accelerated') +
                    barChart('Cancelled', s.cancelled, s.totalStories, '#6c757d', s, 'cancelled') +
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
            expandIcon = `<span class="expand-chevron" style="margin-right: 8px; font-size: 12px; color: #6b7280; transition: transform 0.2s ease; pointer-events: none;">▶</span>`;
        }
        return (
            '<div style="margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: #f9fafb; cursor: ' + cursorStyle + '; transition: all 0.2s ease;" class="bar-chart-container" ' + tooltipContent + '>' +
                '<div style="display: flex; justify-content: space-between; align-items: center; pointer-events: none;">' +
                    `<span style="font-size: 14px; font-weight: 500; color: #374151; display: flex; align-items: center;">${expandIcon}${label}</span>` +
                    `<span style="font-size: 14px; font-weight: 600; color: ${color};">${value} (${percentage}%)</span>` +
                '</div>' +
            '</div>'
        );
    }

    function card(label, value) {
        return (
            '<div style="border:1px solid #e5e7eb; border-radius:8px; padding:12px; background:#fafafa;">' +
                `<div style="font-size:12px; color:#6b7280; margin-bottom:6px;">${label}</div>` +
                `<div style="font-size:20px; font-weight:600; color:#111827;">${value}</div>` +
            '</div>'
        );
    }

    function getDelayBreakdown(stats) {
        let result = 'Delay Breakdown:\n';
        const sorted = Object.keys(stats.delayBreakdown || {}).map(Number).sort((a, b) => a - b);
        if (sorted.length === 0) {
            result += 'No delays recorded';
        } else {
            for (const delayCount of sorted) {
                const count = stats.delayBreakdown[delayCount];
                result += `${delayCount} delay${delayCount > 1 ? 's' : ''}: ${count}\n`;
            }
        }
        return result;
    }

    function compareByTeamEpicTitle(a, b) {
        const cmp = (x, y) => {
            const xl = (x || '').toLowerCase();
            const yl = (y || '').toLowerCase();
            if (xl === yl) return 0;
            return xl < yl ? -1 : 1;
        };
        return cmp(a.teamName, b.teamName) || cmp(a.epicName, b.epicName) || cmp(a.title, b.title);
    }

    function escapeHtml(s) {
        return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderDelayDetails(stories) {
        if (!stories || !stories.length) return '<div style="color:#6b7280;">No items</div>';
        const sorted = [...stories].sort(compareByTeamEpicTitle);
        return sorted.map((s) => {
            const team = escapeHtml(s.teamName);
            const epic = escapeHtml(s.epicName);
            const title = escapeHtml(s.title);
            return '<div style="font-size:12px; color:#374151; padding:2px 0;">' +
                (team ? `<span style="color:#6b7280;">[${team}]</span> ` : '') +
                (epic ? `<span style="color:#6b7280;">[${epic}]</span> ` : '') +
                title +
            '</div>';
        }).join('');
    }

    // Two-row breakdown (Done / Not Done) with collapsible details. Used by
    // both the on-time and accelerated breakdowns.
    function renderDoneNotDoneRows(rowKey, doneStories, notDoneStories, totalStories, leftBorderDone = '#28a745', leftBorderNotDone = '#ffc107') {
        const done = doneStories.length;
        const notDone = notDoneStories.length;
        if (done === 0 && notDone === 0) return null;

        const donePct = totalStories ? ((done / totalStories) * 100).toFixed(1) : 0;
        const notDonePct = totalStories ? ((notDone / totalStories) * 100).toFixed(1) : 0;

        return (
            `<div class="delay-row" id="${rowKey}-done-row" style="margin-bottom: 8px; margin-left: 10px;">` +
                '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                    '<span style="margin-right: 8px; color:#999;">▶</span>' +
                    `<span style="font-size:13px; color:#374151;">Done (${done} / ${donePct}%)</span>` +
                '</div>' +
                `<div class="delay-row-details" id="${rowKey}-done-details" style="display:none; margin-left: 20px; padding:8px; background:#ffffff; border-left: 2px solid ${leftBorderDone};">` +
                    renderDelayDetails(doneStories) +
                '</div>' +
            '</div>' +
            `<div class="delay-row" id="${rowKey}-notdone-row" style="margin-bottom: 8px; margin-left: 10px;">` +
                '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                    '<span style="margin-right: 8px; color:#999;">▶</span>' +
                    `<span style="font-size:13px; color:#374151;">Not Done (${notDone} / ${notDonePct}%)</span>` +
                '</div>' +
                `<div class="delay-row-details" id="${rowKey}-notdone-details" style="display:none; margin-left: 20px; padding:8px; background:#ffffff; border-left: 2px solid ${leftBorderNotDone};">` +
                    renderDelayDetails(notDoneStories) +
                '</div>' +
            '</div>'
        );
    }

    function renderOntimeBreakdown(stats, totalStories) {
        const done = (stats.onTimeStories && stats.onTimeStories.done) || [];
        const notDone = (stats.onTimeStories && stats.onTimeStories.notDone) || [];
        return renderDoneNotDoneRows('ontime', done, notDone, totalStories) ||
            '<div style="color:#6b7280;">No on-time projects</div>';
    }

    function renderAcceleratedBreakdown(stats, totalStories) {
        let acc = stats.acceleratedStories || { done: [], notDone: [] };
        // Backward compat with the old flat-array shape from earlier saves.
        if (Array.isArray(acc)) {
            acc = { done: acc.filter((s) => s.isDone), notDone: acc.filter((s) => !s.isDone) };
        }
        return renderDoneNotDoneRows('accelerated', acc.done || [], acc.notDone || [], totalStories) ||
            '<div style="color:#6b7280;">No accelerated projects</div>';
    }

    function renderCancelledBreakdown(stats) {
        const cancelled = Array.isArray(stats.cancelledStories) ? stats.cancelledStories : [];
        if (cancelled.length === 0) return '<div style="color:#6b7280;">No cancelled projects</div>';
        const items = cancelled.map((s) => {
            const team = escapeHtml(s.teamName);
            const epic = escapeHtml(s.epicName);
            const title = escapeHtml(s.title);
            return '<div style="font-size:12px; color:#374151; padding:2px 0;">' +
                (team ? `<span style="color:#6b7280;">[${team}]</span> ` : '') +
                (epic ? `<span style="color:#6b7280;">[${epic}]</span> ` : '') +
                title +
            '</div>';
        }).join('');
        return '<div style="display:block; margin-left: 20px; padding:8px; background:#ffffff; border-left: 2px solid #dc3545;">' + items + '</div>';
    }

    function renderDelayBreakdown(stats, totalStories) {
        const counts = stats.delayBreakdown || {};
        const sorted = Object.keys(counts).map((n) => parseInt(n, 10)).sort((a, b) => a - b);
        if (sorted.length === 0) return '<div style="color:#6b7280;">No delays recorded</div>';

        return sorted.map((delayCount) => {
            const value = counts[delayCount] || 0;
            const pct = totalStories ? ((value / totalStories) * 100).toFixed(1) : 0;
            const delayGroup = (stats.delayStories && stats.delayStories[delayCount]) || { done: [], notDone: [] };
            const rowId = `delay-row-${delayCount}`;
            const detailsId = `delay-details-${delayCount}`;
            return (
                `<div class="delay-row" id="${rowId}" style="margin-bottom: 8px; margin-left: 10px;">` +
                    '<div class="delay-row-header" style="display:flex; align-items:center; cursor:pointer; padding: 4px 0;">' +
                        '<span style="margin-right: 8px; color:#999;">▶</span>' +
                        `<span style="font-size:13px; color:#374151;">${delayCount} delay${delayCount > 1 ? 's' : ''} (${value} / ${pct}%)</span>` +
                    '</div>' +
                    `<div class="delay-row-details" id="${detailsId}" style="display:none; margin-left: 20px;">` +
                        renderDelaySubBreakdown(delayGroup, delayCount, value) +
                    '</div>' +
                '</div>'
            );
        }).join('');
    }

    function renderDelaySubBreakdown(delayGroup, delayCount, totalCount) {
        // Backward compat with flat-array shape.
        let group = delayGroup;
        if (Array.isArray(group)) {
            group = { done: group.filter((s) => s.isDone), notDone: group.filter((s) => !s.isDone) };
        }
        return renderDoneNotDoneRows(
            `delay-${delayCount}`,
            group.done || [],
            group.notDone || [],
            totalCount
        ) || '';
    }

    function setupDelayBreakdownInteractions() {
        document.querySelectorAll('[id$="-breakdown"] .delay-row').forEach((row) => {
            const details = row.querySelector('.delay-row-details');
            const header = row.querySelector('.delay-row-header');
            const arrow = header ? header.querySelector('span:first-child') : null;

            if (header && header._toggleHandler) {
                header.removeEventListener('click', header._toggleHandler);
            }
            const toggle = () => {
                if (!details) return;
                const isOpen = details.style.display !== 'none';
                details.style.display = isOpen ? 'none' : 'block';
                if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
            };
            if (header) {
                header._toggleHandler = toggle;
                header.addEventListener('click', toggle);
            }
        });
    }

    return {
        openStatsModal,
        closeStatsModal,
        setupTooltips,
        toggleDelayBreakdown,
        computeRoadmapStats,
        renderStatsHtml,
        isDelayChange,
        getDelayBreakdown,
        compareByTeamEpicTitle,
        renderOntimeBreakdown,
        renderAcceleratedBreakdown,
        renderCancelledBreakdown,
        renderDelayBreakdown,
        renderDelaySubBreakdown,
        renderDelayDetails,
        setupDelayBreakdownInteractions,
        barChart,
        card,
    };
}
