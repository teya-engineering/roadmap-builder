// Up/down arrow handlers for reordering stories within an epic, and the
// "ByEpic" variants that locate stories by (epic name, story index) - used
// from the preview-iframe Move Up/Down buttons rendered by RoadmapGenerator.
//
// BTL stories don't carry numbers, so their move helpers are pure DOM swaps.

/**
 * @param {object} deps
 * @param {(epicElement: Element) => void} deps.updateStoryNumbers
 *        Renumbers the story headers within an epic after a reorder.
 * @param {() => void} deps.generatePreview
 */
export function createStoryMoves({ updateStoryNumbers, generatePreview }) {
    function moveStoryUp(storyId) {
        const storyEl = document.getElementById(`story-${storyId}`);
        if (!storyEl) return;
        const previous = storyEl.previousElementSibling;
        if (!previous || !previous.classList.contains('story-section')) return;

        storyEl.parentNode.insertBefore(storyEl, previous);
        updateStoryNumbers(storyEl.closest('.epic-section'));

        // Re-focus the up button so users can keep pressing it without re-aiming.
        setTimeout(() => {
            const upButton = storyEl.querySelector('button[onclick*="moveStoryUp"]');
            if (upButton) upButton.focus({ preventScroll: true });
        }, 10);
        setTimeout(generatePreview, 100);
    }

    function moveStoryDown(storyId) {
        const storyEl = document.getElementById(`story-${storyId}`);
        if (!storyEl) return;
        const next = storyEl.nextElementSibling;
        if (!next || !next.classList.contains('story-section')) return;

        const afterNext = next.nextElementSibling;
        if (afterNext) {
            storyEl.parentNode.insertBefore(storyEl, afterNext);
        } else {
            storyEl.parentNode.appendChild(storyEl);
        }
        updateStoryNumbers(storyEl.closest('.epic-section'));

        setTimeout(() => {
            const downButton = storyEl.querySelector('button[onclick*="moveStoryDown"]');
            if (downButton) downButton.focus({ preventScroll: true });
        }, 10);
        setTimeout(generatePreview, 100);
    }

    function findEpicByName(name) {
        for (const epicEl of document.querySelectorAll('.epic-section')) {
            const epicId = epicEl.id.split('-')[1];
            const nameEl = document.getElementById(`epic-name-${epicId}`);
            if (nameEl && nameEl.value.trim() === name) return epicEl;
        }
        return null;
    }

    function moveStoryUpByEpic(epicName, storyIndex) {
        const epicEl = findEpicByName(epicName);
        if (!epicEl) {
            console.error('Could not find EPIC:', epicName);
            return;
        }
        const container = epicEl.querySelector('[id^="stories-container-"]');
        if (!container) return;

        const stories = Array.from(container.children).filter(
            (el) => el.classList && el.classList.contains('story-section')
        );
        if (storyIndex <= 0 || storyIndex >= stories.length) return;

        // Swap with previous, then re-append in new order. appendChild moves
        // existing nodes (no cloning) so listeners survive.
        [stories[storyIndex - 1], stories[storyIndex]] = [stories[storyIndex], stories[storyIndex - 1]];
        stories.forEach((node) => container.appendChild(node));

        updateStoryNumbers(epicEl);
        setTimeout(generatePreview, 100);
    }

    function moveStoryDownByEpic(epicName, storyIndex) {
        const epicEl = findEpicByName(epicName);
        if (!epicEl) return;

        const stories = epicEl.querySelectorAll('.story-section');
        if (storyIndex < 0 || storyIndex >= stories.length - 1) return;

        const storyToMove = stories[storyIndex];
        if (!storyToMove) return;
        const container = storyToMove.parentNode;
        if (!container) return;

        // Skip non-story siblings (the inline +Add button etc.) when finding
        // the swap target.
        let nextSibling = storyToMove.nextElementSibling;
        while (nextSibling && !nextSibling.classList.contains('story-section')) {
            nextSibling = nextSibling.nextElementSibling;
        }
        if (!nextSibling) return;

        const afterNext = nextSibling.nextElementSibling;
        if (afterNext) container.insertBefore(storyToMove, afterNext);
        else container.appendChild(storyToMove);

        updateStoryNumbers(epicEl);
        setTimeout(generatePreview, 100);
    }

    function moveBTLStoryUp(storyId) {
        const story = document.getElementById(`story-${storyId}`);
        if (!story) return;
        const previous = story.previousElementSibling;
        if (previous && previous.classList.contains('story-section')) {
            story.parentNode.insertBefore(story, previous);
        }
    }

    function moveBTLStoryDown(storyId) {
        const story = document.getElementById(`story-${storyId}`);
        if (!story) return;
        const next = story.nextElementSibling;
        if (next && next.classList.contains('story-section')) {
            story.parentNode.insertBefore(next, story);
        }
    }

    return {
        moveStoryUp, moveStoryDown,
        moveStoryUpByEpic, moveStoryDownByEpic,
        moveBTLStoryUp, moveBTLStoryDown,
    };
}
