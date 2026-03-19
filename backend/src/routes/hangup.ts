export function createSingleHangup(sendBye: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;

  return async (): Promise<void> => {
    if (!pending) {
      pending = sendBye();
    }

    await pending;
  };
}
