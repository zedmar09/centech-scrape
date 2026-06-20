export type QueueStatus = "queued" | "parsing" | "done" | "error";

export type StagedPayrollFile = {
  id: string;
  file: File;
  name: string;
  size: number;
};

export type QueuedPayrollFile<TParseResult> = {
  id: string;
  name: string;
  size: number;
  status: QueueStatus;
  result?: TParseResult;
  error?: string;
};

export type QueueEntry<TParseResult> = {
  file: File;
  queuedFile: QueuedPayrollFile<TParseResult>;
};

export function createStagedPayrollFiles(files: File[]): StagedPayrollFile[] {
  return files.map((file, index) => ({
    id: makeQueueId(file, index),
    file,
    name: file.name,
    size: file.size,
  }));
}

export function createQueueEntriesFromStagedFiles<TParseResult>(
  stagedFiles: StagedPayrollFile[],
): QueueEntry<TParseResult>[] {
  return stagedFiles.map((stagedFile) => ({
    file: stagedFile.file,
    queuedFile: {
      id: stagedFile.id,
      name: stagedFile.name,
      size: stagedFile.size,
      status: "queued",
    },
  }));
}

function makeQueueId(file: File, index: number) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${index.toString(36)}`;

  return `${file.name}-${file.size}-${file.lastModified}-${suffix}`;
}
