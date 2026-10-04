<script lang="ts">
	import jsQR from 'jsqr';

	let {
		onscan,
		disabled = false
	}: {
		onscan: (text: string) => void;
		disabled?: boolean;
	} = $props();

	let videoEl: HTMLVideoElement | null = $state(null);
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let status = $state<'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported' | 'error'>('idle');
	let message = $state('');
	let torchOn = $state(false);

	let stream: MediaStream | null = null;
	let rafId = 0;
	// Ignore repeat reads of the same code so one scan fires exactly once.
	let lastText = '';
	let lastAt = 0;
	const COOLDOWN_MS = 2500;

	async function start() {
		if (status === 'scanning' || status === 'starting') return;
		status = 'starting';
		message = '';
		try {
			if (!navigator.mediaDevices?.getUserMedia) {
				status = 'unsupported';
				message = 'This browser cannot use the camera. Type the code instead, or use a different browser.';
				return;
			}
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' },
				audio: false
			});
			if (videoEl) {
				videoEl.srcObject = stream;
				await videoEl.play();
			}
			status = 'scanning';
			rafId = requestAnimationFrame(tick);
		} catch (err) {
			const e = err as { name?: string };
			if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
				status = 'denied';
				message = 'Camera access was blocked. Allow the camera for this page, then press Try again.';
			} else if (e?.name === 'NotFoundError') {
				status = 'unsupported';
				message = 'No camera was found on this device.';
			} else {
				status = 'error';
				message = 'The camera could not start. You can still type the code manually below.';
			}
		}
	}

	function stop() {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		if (stream) {
			for (const track of stream.getTracks()) track.stop();
			stream = null;
		}
		if (videoEl) videoEl.srcObject = null;
	}

	function tick() {
		if (!videoEl || !canvasEl || videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA) {
			rafId = requestAnimationFrame(tick);
			return;
		}
		const width = videoEl.videoWidth;
		const height = videoEl.videoHeight;
		if (!width || !height) {
			rafId = requestAnimationFrame(tick);
			return;
		}
		const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
		if (!ctx) return;
		// Downscale: jsQR is O(pixels) and a full 1080p frame every frame is
		// enough to drop frames on mid-range phones.
		const scale = Math.min(1, 480 / Math.max(width, height));
		canvasEl.width = Math.round(width * scale);
		canvasEl.height = Math.round(height * scale);
		ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
		const image = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
		const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
		if (found?.data) {
			const now = Date.now();
			if (found.data !== lastText || now - lastAt > COOLDOWN_MS) {
				lastText = found.data;
				lastAt = now;
				onscan(found.data);
			}
		}
		rafId = requestAnimationFrame(tick);
	}

	async function toggleTorch() {
		if (!stream) return;
		const track = stream.getVideoTracks()[0];
		const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : undefined;
		if (!caps || !('torch' in caps)) {
			message = 'This camera has no flashlight control.';
			return;
		}
		torchOn = !torchOn;
		try {
			// `torch` is a non-standard constraint that browsers expose through
			// `advanced` but do not type, so the cast is deliberate.
			await track.applyConstraints({
				advanced: [{ torch: torchOn }]
			} as unknown as MediaTrackConstraints);
		} catch {
			message = 'The flashlight could not be switched.';
		}
	}

	$effect(() => {
		if (disabled) stop();
	});

	$effect(() => {
		return () => stop();
	});
</script>

<div class="flex flex-col gap-3">
	<div class="relative overflow-hidden rounded-lg border-2 border-dashed border-border bg-black">
		<video bind:this={videoEl} playsinline muted class="aspect-square w-full object-cover" aria-label="Camera preview"></video>
		<canvas bind:this={canvasEl} class="hidden" aria-hidden="true"></canvas>

		{#if status !== 'scanning'}
			<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
				<p class="text-sm text-white/90">
					{status === 'starting' ? 'Starting the camera…' : 'Point the camera at a student’s code'}
				</p>
				{#if status === 'idle' || status === 'denied' || status === 'error' || status === 'unsupported'}
					<button
						type="button"
						class="rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-900"
						onclick={start}
						disabled={disabled}
					>
						{status === 'idle' ? 'Start camera' : 'Try again'}
					</button>
				{/if}
			</div>
		{:else}
			<div class="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
				<span class="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
					Hold the student’s code inside the frame
				</span>
			</div>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#if status === 'scanning'}
			<button type="button" class="rounded-md border border-border px-3 py-1.5 text-sm" onclick={stop}>
				Stop camera
			</button>
			<button type="button" class="rounded-md border border-border px-3 py-1.5 text-sm" onclick={toggleTorch}>
				{torchOn ? 'Turn light off' : 'Turn light on'}
			</button>
		{/if}
	</div>

	{#if message}
		<p class="text-sm text-amber-700" role="status">{message}</p>
	{/if}
</div>