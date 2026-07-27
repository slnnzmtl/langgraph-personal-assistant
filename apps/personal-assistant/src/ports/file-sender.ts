export interface IFileSender {
  sendFile(absolutePath: string): Promise<void>;
  setCurrentChatId(chatId: number): void;
}
