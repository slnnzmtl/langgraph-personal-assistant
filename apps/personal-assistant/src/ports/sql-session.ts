export type SqlSession = {
  executeSql<T = unknown>(sql: string): Promise<T>;
  close(): Promise<void>;
};
