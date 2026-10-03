let taskCounter = 0;
let workerCounter = 0;

export function generateTaskId(): string {
  taskCounter += 1;
  return `t${taskCounter}`;
}

export function generateWorkerId(): string {
  workerCounter += 1;
  return `w${workerCounter}`;
}

export function resetTaskCounter(): void {
  taskCounter = 0;
}

export function resetWorkerCounter(): void {
  workerCounter = 0;
}

export function resetAllCounters(): void {
  taskCounter = 0;
  workerCounter = 0;
}
