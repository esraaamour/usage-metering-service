export interface ConsumeInput {
    accountId: string;
    userExternalId: string;
    units: number;
    requestId: string;
}
interface LevelState {
    planId: string;
    monthlyAllowance: number;
    maxPerRequest: number;
    used: number;
    remaining: number;
}
export interface Decision {
    accepted: boolean;
    requestId: string;
    userId: string;
    units: number;
    month: string;
    rejection: {
        level: 'account' | 'user';
        rule: 'max_per_request' | 'monthly_allowance';
    } | null;
    account: LevelState;
    user: LevelState;
}
export interface ConsumeResult {
    decision: Decision;
    replayed: boolean;
}
/**
 * Executes a quota consumption transaction with proper ACID compliance and error rollback.
 */
export declare function consume(input: ConsumeInput): Promise<ConsumeResult>;
export {};
//# sourceMappingURL=consume.d.ts.map