CREATE TABLE `ai_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` enum('openai','anthropic','gemini') NOT NULL,
	`apiKey` text,
	`isActive` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_configs_provider_unique` UNIQUE(`provider`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(128) NOT NULL,
	`details` json,
	`ipAddress` varchar(64),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brainstorm_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`context` text NOT NULL,
	`ideas` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `brainstorm_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`amount` int NOT NULL,
	`type` enum('purchase','usage','refund','admin_adjustment') NOT NULL,
	`description` text,
	`stripePaymentId` varchar(128),
	`researchId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_routing` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phase` enum('wide_scan','gap_detection','deep_dives','synthesis','polling','brainstorm') NOT NULL,
	`primaryModel` varchar(128) NOT NULL,
	`fallbackModel` varchar(128),
	`systemPrompt` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_routing_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_routing_phase_unique` UNIQUE(`phase`)
);
--> statement-breakpoint
CREATE TABLE `research_phases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchId` int NOT NULL,
	`phase` enum('wide_scan','gap_detection','deep_dives','synthesis') NOT NULL,
	`status` enum('pending','running','done','failed') NOT NULL DEFAULT 'pending',
	`summary` text,
	`durationMs` int,
	`sourcesFound` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_phases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `researches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`nicheName` varchar(512) NOT NULL,
	`description` text,
	`strategy` enum('gaps','predator','provisioning') NOT NULL DEFAULT 'gaps',
	`status` enum('pending','running','done','failed') NOT NULL DEFAULT 'pending',
	`verdict` enum('GO','KILL','CONDITIONAL'),
	`scoreMarketSize` decimal(4,2),
	`scoreCompetition` decimal(4,2),
	`scoreFeasibility` decimal(4,2),
	`scoreMonetization` decimal(4,2),
	`scoreTimeliness` decimal(4,2),
	`synthesisScore` decimal(4,2),
	`reportMarkdown` text,
	`shareToken` varchar(64),
	`creditsUsed` int NOT NULL DEFAULT 1,
	`errorMessage` text,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `researches_id` PRIMARY KEY(`id`),
	CONSTRAINT `researches_shareToken_unique` UNIQUE(`shareToken`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchId` int NOT NULL,
	`phaseId` int,
	`url` text NOT NULL,
	`title` text,
	`snippet` text,
	`sourceType` enum('academic','industry','news','blog','community') NOT NULL DEFAULT 'blog',
	`publishedAt` varchar(32),
	`relevanceScore` decimal(3,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `survey_responses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`surveyId` int NOT NULL,
	`answers` json NOT NULL,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `survey_responses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `surveys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`researchId` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`questions` json NOT NULL,
	`responseCount` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`synthesisUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `surveys_id` PRIMARY KEY(`id`),
	CONSTRAINT `surveys_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `credits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `language` enum('hu','en') DEFAULT 'hu' NOT NULL;