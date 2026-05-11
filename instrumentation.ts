export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startContinuousOperationalLoop } = await import(
      "@/app/lib/continuousOperationalScheduler"
    );

    startContinuousOperationalLoop();
  }
}
