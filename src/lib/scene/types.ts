/**
 * The contract between `scene/` and `render/`.
 *
 * Deliberately imports nothing. `render/` consumes these descriptors and must never
 * reach into `store/` or the domain model — a renderer that can only see a
 * `Creature` cannot accidentally couple pixels to task data.
 *
 * No creature position is ever persisted. The tank is a projection of the task
 * data and never a source of it.
 */

export type CreatureKind = 'fish' | 'bubble' | 'ghost' | 'koi' | 'treat' | 'pearl' | 'sync' | 'shark';

/** Prototype: online/offline/signed-out shown as a fish tint, not a task-derived state. */
export type SyncMood = 'signed-out' | 'offline' | 'online';

export type Creature = {
	/** Task id, or a synthetic id for pearls and koi, which have no task of their own. */
	id: string;
	kind: CreatureKind;
	/** Absent on pearls and koi; present on anything tapping opens a sheet for. */
	taskId?: string;
	label: string;
	/**
	 * Resting depth: 0 is the waterline, 1 is the tank floor.
	 *
	 * Depth encodes imminence. A bubble firing within the hour floats at eye level;
	 * one firing next week rests down in the plants; free-text and undated bubbles
	 * sit on the floor. Twenty waiting tasks stay readable because nineteen are
	 * stacked out of the swim area.
	 */
	depth: number;
	/**
	 * The bubble's depth is a parking spot, not a reading: nothing schedules this task,
	 * so its height reports no moment and `place()` is free to drift it.
	 *
	 * Without this the renderer would have to infer "no clock" from `depth === 1`, which
	 * couples a drawing decision to a sentinel it cannot see the meaning of.
	 */
	untimed?: boolean;
	/** Free-text condition, or one whose trigger target is gone. Drawn as a dashed outline. */
	dashed?: boolean;
	/** Treat the current pearl balance cannot afford. Drawn dim. */
	locked?: boolean;
	/**
	 * A treat that has been paid for and is now swimming. Drawn as the amber prize
	 * fish rather than an ordinary one — otherwise buying a guilty pleasure looks
	 * like it deleted the thing you just bought.
	 */
	claimed?: boolean;
	/** Lantern price in pearls. */
	cost?: number;
	/** Pointer picking radius — canvas offers no hit-testing, so each creature carries its own. */
	tapRadius: number;
	/** Present only on the `sync` prototype creature. */
	mood?: SyncMood;
};

export type Scene = {
	creatures: Creature[];
	/** 0–1, non-treat tasks done today. Drives the Progress palette and mood number. */
	clearedPct: number;
	/** Derived balance, never stored: earned − spent. */
	pearls: number;
	/**
	 * 0–1, how recently something was finished. Drives the feeding flourish.
	 *
	 * Derived from `completedAt`, never stored, and transient by construction: it decays
	 * to zero and stays there, so it cannot accumulate, cannot be missed, and costs
	 * nothing if you never look at the tank.
	 */
	feeding: number;
};
