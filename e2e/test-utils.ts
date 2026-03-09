export async function wait(timeout: number) {
    await new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}
