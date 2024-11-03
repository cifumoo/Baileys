import { proto } from '../../WAProto'

export type NewsletterReactionMode = 'ALL' | 'BASIC' | 'NONE'
export type NewsletterState = 'ACTIVE' | 'GEOSUSPENDED' | 'SUSPENDED'
export type NewsletterVerification = 'VERIFIED' | 'UNVERIFIED'
export type NewsletterMute = 'ON' | 'OFF' | 'UNDEFINED'
export type NewsletterViewRole = 'ADMIN' | 'GUEST' | 'OWNER' | 'SUBSCRIBER'

export type NewsletterViewerMetadata = {
    mute: NewsletterMute
    view_role: NewsletterViewRole
}

export type NewsletterMetadata = {
    id: string
    state: NewsletterState
    creation_time: number
    name: string
    nameTime: number
    description: string
    descriptionTime: number
    invite: string
    handle: null
    picture: string | null
    preview: string | null
    reaction_codes?: NewsletterReactionMode
    subscribers: number
    verification: NewsletterVerification
    viewer_metadata: NewsletterViewerMetadata
}

export type SubscriberAction = 'promote' | 'demote'
export type ReactionModeUpdate = { reaction_codes: { blocked_codes: null, enabled_ts_sec: null, value: NewsletterReactionMode }}
export type NewsletterSettingsUpdate = ReactionModeUpdate
export type NewsletterReaction = { count: number, code: string }
export type NewsletterFetchedUpdate = {
    server_id: string
    views?: number
    reactions: NewsletterReaction[]
    message?: proto.IWebMessageInfo
}

export enum MexOperations {
    PROMOTE = 'NotificationNewsletterAdminPromote',
    DEMOTE = 'NotificationNewsletterAdminDemote',
    UPDATE = 'NotificationNewsletterUpdate'
}

export enum XWAPaths {
    PROMOTE = 'xwa2_notify_newsletter_admin_promote',
    DEMOTE = 'xwa2_notify_newsletter_admin_demote',
    ADMIN_COUNT = 'xwa2_newsletter_admin',
    CREATE = 'xwa2_newsletter_create',
    NEWSLETTER = 'xwa2_newsletter',
    METADATA_UPDATE = 'xwa2_notify_newsletter_on_metadata_update'
}

export enum QueryIds {
    JOB_MUTATION = '7150902998257522',
    METADATA = '6620195908089573',
    UNFOLLOW = '7238632346214362',
    FOLLOW = '7871414976211147',
    UNMUTE = '7337137176362961',
    MUTE = '25151904754424642',
    CREATE = '6996806640408138',
    ADMIN_COUNT = '7130823597031706',
    CHANGE_OWNER = '7341777602580933',
    DELETE = '8316537688363079',
    DEMOTE = '6551828931592903'
}

// Your functions and implementations start here:

import { decryptMessageNode, generateMessageID, generateProfilePicture } from '../Utils'
import { BinaryNode, getAllBinaryNodeChildren, getBinaryNodeChild, getBinaryNodeChildren, S_WHATSAPP_NET } from '../WABinary'
import { SocketConfig, WAMediaUpload } from '../Types'
import { makeGroupsSocket } from './groups'

export const makeNewsletterSocket = (config: SocketConfig) => {
	const sock = makeGroupsSocket(config)
	const { authState, signalRepository, query, generateMessageTag } = sock

	const encoder = new TextEncoder()

	const newsletterQuery = async(jid: string, type: 'get' | 'set', content: BinaryNode[]) => (
		query({
			tag: 'iq',
			attrs: {
				id: generateMessageTag(),
				type,
				xmlns: 'newsletter',
				to: jid,
			},
			content
		})
	)

	const newsletterWMexQuery = async(jid: string | undefined, queryId: QueryIds, content?: object) => (
		query({
			tag: 'iq',
			attrs: {
				id: generateMessageTag(),
				type: 'get',
				xmlns: 'w:mex',
				to: S_WHATSAPP_NET,
			},
			content: [
				{
					tag: 'query',
					attrs: { 'query_id': queryId },
					content: encoder.encode(
						JSON.stringify({
							variables: {
								'newsletter_id': jid,
								...content
							}
						})
					)
				}
			]
		})
	)

	const parseFetchedUpdates = async(node: BinaryNode, type: 'messages' | 'updates') => {
		let child

		if(type === 'messages') {
			child = getBinaryNodeChild(node, 'messages')
		} else {
			const parent = getBinaryNodeChild(node, 'message_updates')
			child = getBinaryNodeChild(parent, 'messages')
		}

		return await Promise.all(getAllBinaryNodeChildren(child).map(async messageNode => {
			messageNode.attrs.from = child?.attrs.jid as string

			const views = parseInt(getBinaryNodeChild(messageNode, 'views_count')?.attrs?.count || '0')
			const reactionNode = getBinaryNodeChild(messageNode, 'reactions')
			const reactions = getBinaryNodeChildren(reactionNode, 'reaction')
				.map(({ attrs }) => ({ count: +attrs.count, code: attrs.code } as NewsletterReaction))

			const data: NewsletterFetchedUpdate = {
				'server_id': messageNode.attrs.server_id,
				views,
				reactions
			}

			if(type === 'messages') {
				const { fullMessage: message, decrypt } = await decryptMessageNode(
					messageNode,
                    authState.creds.me!.id,
                    authState.creds.me!.lid || '',
                    signalRepository,
                    config.logger
				)

				await decrypt()

				data.message = message
			}

			return data
		}))
	}
    // The rest of the functions go here...
}

// Extract the metadata
export const extractNewsletterMetadata = (node: BinaryNode, isCreate?: boolean) => {
	const result = getBinaryNodeChild(node, 'result')?.content?.toString()
	const metadataPath = JSON.parse(result!).data[isCreate ? XWAPaths.CREATE : XWAPaths.NEWSLETTER]

	const metadata: NewsletterMetadata = {
		id: metadataPath.id,
		state: metadataPath.state.type,
		'creation_time': +metadataPath.thread_metadata.creation_time,
		name: metadataPath.thread_metadata.name.text,
		nameTime: +metadataPath.thread_metadata.name.update_time,
		description: metadataPath.thread_metadata.description.text,
		descriptionTime: +metadataPath.thread_metadata.description.update_time,
		invite: metadataPath.thread_metadata.invite,
		handle: metadataPath.thread_metadata.handle,
		picture: metadataPath.thread_metadata.picture.direct_path || null,
		preview: metadataPath.thread_metadata.preview.direct_path || null,
		'reaction_codes': metadataPath.thread_metadata?.settings?.reaction_codes?.value,
		subscribers: +metadataPath.thread_metadata.subscribers_count,
		verification: metadataPath.thread_metadata.verification,
		'viewer_metadata': metadataPath.viewer_metadata
	}

	return metadata
}