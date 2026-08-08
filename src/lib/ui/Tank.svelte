<script lang="ts">
	import { onMount } from 'svelte';
	import { createRenderLoop, type Frame } from '../render/loop';

	/**
	 * The tank: one canvas, scaled for device pixel ratio, driven by the render loop.
	 *
	 * Painting is injected rather than imported. The loop reads the store with `get()`
	 * inside `draw` and never subscribes — that is the property Svelte was chosen for,
	 * so do not replace the callback with reactive state that re-renders the component
	 * every frame.
	 */
	type Props = {
		/** Paints one frame. S12 and S13 supply the real water and creatures. */
		draw?: (ctx: CanvasRenderingContext2D, frame: Frame, size: { w: number; h: number }) => void;
	};

	const { draw = placeholder }: Props = $props();

	let canvas: HTMLCanvasElement;
	let size = { w: 0, h: 0 };

	/** A flat wash so the tank reads as water before S12 lands. */
	function placeholder(ctx: CanvasRenderingContext2D, _frame: Frame, { w, h }: { w: number; h: number }) {
		const gradient = ctx.createLinearGradient(0, 0, 0, h);
		gradient.addColorStop(0, '#7FD4E8');
		gradient.addColorStop(1, '#4FC3D9');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, w, h);
	}

	/**
	 * Sizes the backing store to the device's real pixels while keeping the drawing
	 * API in CSS pixels. Without this the tank is blurry on every retina display.
	 */
	function resize(ctx: CanvasRenderingContext2D) {
		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();

		size = { w: rect.width, h: rect.height };
		canvas.width = Math.round(rect.width * dpr);
		canvas.height = Math.round(rect.height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	onMount(() => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		resize(ctx);
		const observer = new ResizeObserver(() => resize(ctx));
		observer.observe(canvas);

		const loop = createRenderLoop({
			draw: (frame) => draw(ctx, frame, size)
		});
		loop.start();

		return () => {
			loop.stop();
			observer.disconnect();
		};
	});
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}
</style>
