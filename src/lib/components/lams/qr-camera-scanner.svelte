<script lang="ts">
	import { onMount } from 'svelte';
	import jsQR from 'jsqr';
	import { CameraOff, Keyboard, ScanLine } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { parseStationUrl, type ScannedStation } from '$lib/lams/station';

	/**
	 * Reads the station QR with this device's own camera.
	 *
	 * Students normally get here by pointing the phone's *system* camera at the
	 * screen, which opens a link. This is the way in when that is awkward — a
	 * locked-down browser, a camera app that will not follow links, or a phone
	 * whose scanner opened the wrong app.
	 *
	 * Decoding is done here rather than by the camera app, so the lecture URL
	 * arrives as text and is parsed by `parseStationUrl` before anything is
	 * navigated to. A poster or an old screenshot is refused locally instead of
	 * sending the student to a page that can only fail.
	 */
	let {
		/** Called once with the first valid station QR. */
		onscanned,
		/** How often a frame is decoded. 10/s reads a held-up screen easily. */
		framesPerSecond = 10
	}: {
		onscanned: (station: ScannedStation) => void | Promise<void>;
		framesPerSecond?: number;
	} = $props();

	type CameraStage = 'starting' | 'scanning' | 'blocked' | 'done';

	let stage = $state<CameraStage>('starting');
	let error = $state('');
	let cameraHelp = $state('');
	/** Shown when a QR was read but was not one of ours, so the user learns why. */
	let rejected = $state('');
	let video = $state<HTMLVideoElement | null>(null);
	let stream: MediaStream | null = null;
	let frameHandle = 0;
	let stopped = false;

	/** The manual route, for a camera that cannot be granted or focused. */
	let manualOpen = $state(false);
	let manualUrl = $state('');

	/** Decoding at capture resolution is wasted work; QR needs ~400 px to be legible. */
	const DECODE_MAX_EDGE_PX = 640;

	/**
	 * One canvas for the whole session, resized only when the camera resolution
	 * changes. Allocating one per frame would hand the garbage collector ten
	 * canvases a second on a phone that is already doing the decoding.
	 */
	let frameCanvas: HTMLCanvasElement | null = null;
	let frameContext: CanvasRenderingContext2D | null = null;

	onMount(() => {
		void start();
		return () => stop();
	});

	function stop() {
		stopped = true;
		if (frameHandle) cancelAnimationFrame(frameHandle);
		frameHandle = 0;
		// Releasing every track is what turns the camera light off. Dropping the
		// stream without this leaves the phone recording until the tab closes.
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
	}

	/** Turn a getUserMedia failure into something a student can act on. */
	function explainCameraError(err: unknown): { message: string; help: string } {
		const name = err instanceof DOMException ? err.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError') {
			return {
				message: 'LAMS is not allowed to use your camera.',
				help: 'Allow camera access for this site in your browser settings, then reload this page. Or scan the code with your normal camera app instead.'
			};
		}
		if (name === 'NotFoundError' || name === 'OverconstrainedError') {
			return {
				message: 'No camera was found on this device.',
				help: 'Scan the screen with another phone, or ask your class rep to add you by hand.'
			};
		}
		if (name === 'NotReadableError') {
			return {
				message: 'The camera is already being used by another app.',
				help: 'Close the other app or tab that is using it, then try again.'
			};
		}
		return {
			message: 'The camera could not be started.',
			help: 'Use your normal camera app to scan the code on the screen instead.'
		};
	}

	async function start() {
		if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			stage = 'blocked';
			error = 'This browser cannot open the camera.';
			cameraHelp =
				'Scan the code on the screen with your normal camera app instead — it opens the same page.';
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				// The rear camera is the one pointed at the screen. `ideal` rather
				// than `exact`, because a laptop has only a front-facing one and
				// refusing to start there would be needless.
				video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
				audio: false
			});
		} catch (err) {
			const explained = explainCameraError(err);
			stage = 'blocked';
			error = explained.message;
			cameraHelp = explained.help;
			return;
		}

		if (stopped) {
			stop();
			return;
		}

		if (video) {
			video.srcObject = stream;
			try {
				await video.play();
			} catch {
				// Autoplay refusal is not fatal: the frame loop below waits for
				// real frames, and the user can tap play via the poster controls.
			}
		}
		stage = 'scanning';
		scheduleFrame();
	}

	function scheduleFrame() {
		if (stopped || stage !== 'scanning') return;
		const interval = 1000 / Math.max(1, framesPerSecond);
		const tick = () => {
			if (stopped || stage !== 'scanning') return;
			decodeFrame();
			frameHandle = window.setTimeout(() => {
				frameHandle = requestAnimationFrame(tick);
			}, interval) as unknown as number;
		};
		frameHandle = requestAnimationFrame(tick);
	}

	function decodeFrame() {
		const element = video;
		if (!element || element.readyState < 2 || element.videoWidth === 0) return;

		const scale = Math.min(1, DECODE_MAX_EDGE_PX / Math.max(element.videoWidth, element.videoHeight));
		const width = Math.max(1, Math.round(element.videoWidth * scale));
		const height = Math.max(1, Math.round(element.videoHeight * scale));

		if (!frameCanvas) {
			frameCanvas = document.createElement('canvas');
			frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
		}
		if (!frameCanvas || !frameContext) return;
		if (frameCanvas.width !== width || frameCanvas.height !== height) {
			frameCanvas.width = width;
			frameCanvas.height = height;
		}
		frameContext.drawImage(element, 0, 0, width, height);

		let pixels: Uint8ClampedArray;
		try {
			pixels = frameContext.getImageData(0, 0, width, height).data;
		} catch {
			// A tainted canvas cannot happen from getUserMedia, but a browser
			// extension that injects into the video can cause it. Skip the frame
			// rather than tearing down a working camera.
			return;
		}

		let read: string | null = null;
		try {
			read = jsQR(pixels, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
		} catch {
			// A malformed frame is not a reason to stop scanning.
			return;
		}
		if (!read) return;

		const station = parseStationUrl(read, window.location.origin);
		if (!station) {
			rejected = 'That code is not a LAMS attendance code. Point the camera at the screen at the front of the hall.';
			return;
		}

		rejected = '';
		stage = 'done';
		stop();
		void onscanned(station);
	}

	function submitManual(e: SubmitEvent) {
		e.preventDefault();
		const station = parseStationUrl(manualUrl.trim(), window.location.origin);
		if (!station) {
			rejected = 'That does not look like a LAMS attendance link. Paste the whole link, or scan the screen.';
			return;
		}
		rejected = '';
		stage = 'done';
		stop();
		void onscanned(station);
	}
</script>

<div class="flex flex-col items-center gap-3">
	{#if stage === 'blocked'}
		<div class="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 text-center">
			<CameraOff class="mx-auto size-8 text-amber-700" aria-hidden="true" />
			<p class="mt-2 text-sm font-semibold text-amber-900">{error}</p>
			<p class="mt-1 text-xs text-amber-900">{cameraHelp}</p>
		</div>
	{:else}
		<!--
			The reticle is purely a aiming aid: it tells the student how much of the
			frame the code should fill, which is the difference between a scan that
			lands in a second and one that never does.
		-->
		<div class="relative w-full overflow-hidden rounded-lg border border-border bg-black">
			<video
				bind:this={video}
				class="aspect-square w-full object-cover"
				playsinline
				muted
				autoplay
				aria-label="Camera viewfinder for scanning the attendance code"
			></video>
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div class="size-2/3 max-h-64 max-w-64 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"></div>
			</div>
			{#if stage === 'starting'}
				<p class="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-xs text-white">
					Starting the camera…
				</p>
			{:else if stage === 'scanning'}
				<p class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/60 p-2 text-center text-xs text-white">
					<ScanLine class="size-3.5" aria-hidden="true" /> Point at the code on the screen at the front
				</p>
			{:else}
				<p class="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-xs text-white">
					Code read. Opening your attendance…
				</p>
			{/if}
		</div>
	{/if}

	{#if rejected}
		<p class="w-full rounded-md bg-red-50 p-2 text-center text-xs text-red-800" role="alert">{rejected}</p>
	{/if}

	{#if stage !== 'done'}
		<button
			type="button"
			class="flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
			onclick={() => (manualOpen = !manualOpen)}
			aria-expanded={manualOpen}
		>
			<Keyboard class="size-3.5" aria-hidden="true" />
			{manualOpen ? 'Hide the manual option' : 'Camera will not work?'}
		</button>
	{/if}

	{#if manualOpen && stage !== 'done'}
		<form class="flex w-full flex-col gap-2 rounded-md border border-border p-3" onsubmit={submitManual}>
			<Label for="qcs-url">Paste the attendance link</Label>
			<p class="text-xs text-muted-foreground">
				If your camera app opens links, scanning the screen with it gets you here directly and you do not
				need this box.
			</p>
			<Input id="qcs-url" bind:value={manualUrl} placeholder="https://…/a/…?c=123456" required />
			<Button type="submit" variant="outline" size="sm">Open that lecture</Button>
		</form>
	{/if}
</div>
