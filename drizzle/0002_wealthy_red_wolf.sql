CREATE TABLE `decision_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchId` int NOT NULL,
	`scores` json NOT NULL,
	`verdict` enum('GO','KILL','CONDITIONAL') NOT NULL,
	`rationale` json NOT NULL,
	`positiveDrivers` json,
	`negativeDrivers` json,
	`missingEvidence` json,
	`nextActions` json,
	`evidenceVersion` int NOT NULL DEFAULT 1,
	`evidenceCount` int NOT NULL DEFAULT 0,
	`sourceSynthesisId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `decision_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchId` int NOT NULL,
	`type` varchar(32) NOT NULL,
	`claim` text NOT NULL,
	`sourceUrl` text,
	`sourceTitle` varchar(512),
	`sourceDate` date,
	`sourceQuality` varchar(16),
	`confidence` decimal(3,2),
	`dimensions` json NOT NULL,
	`stance` varchar(16) NOT NULL,
	`rawPayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_decision_snapshots_research_id` ON `decision_snapshots` (`researchId`);--> statement-breakpoint
CREATE INDEX `idx_decision_snapshots_research_version` ON `decision_snapshots` (`researchId`,`evidenceVersion`);--> statement-breakpoint
CREATE INDEX `idx_evidence_research_id` ON `evidence` (`researchId`);