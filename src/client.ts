import {
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    Message,
    MessageFlags,
    MessageType,
    OmitPartialGroupDMChannel
} from "discord.js";
import fs from "node:fs/promises";

export class DiscordAdapter {
    private _client: Client;
    private config: {CLIENT_ID?: string, CLIENT_TOKEN?: string};

    constructor(private token?: string) {
        this.config = {
            CLIENT_ID: process.env.CLIENT_ID,
            CLIENT_TOKEN: this.token,
        }

        this._client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        })
    }

    public login = async () => {
        this._client.on(Events.ClientReady, async (ct) => {
            console.log(ct.user.tag);
        })

        this._client.on(Events.MessageCreate, this.onSlur)

        await this._client.login(this.config.CLIENT_TOKEN)
    }

    //msg:  OmitPartialGroupDMChannel<Message<boolean>>
    public onSlur = async (msg: OmitPartialGroupDMChannel<Message<boolean>>) => {
        if(!await this.testContentForSlurs(msg.content)) {
            console.log("MSG INVALID");
            return;
        }

        if(msg.author.bot)  {
            console.log("INVALID USER");
            return;
        }

        const guildId = process.env.FBI_ID;
        const targetUserId = process.env.CZECHOPOLAK_ID;
        const generalChannelId = process.env.GENERAL_CHANNEL_ID ?? ''

        const activeUser = await this.getUser(guildId, targetUserId);
        const channel = await this._client.channels.fetch(generalChannelId)

        if(channel?.isSendable()){
            channel.send({
                embeds: [
                    this.createErrorEmbed(`❌ Chomik bluzga po raz kolejny`),
                    this.createContentEmbed(`@${msg.author.tag} powiedział:  ${msg.content}` )
                ],
            })
        }
    }

    private testContentForSlurs = async (text: string): Promise<boolean> => {
        const slurs = new Set(JSON.parse(await fs.readFile("./data/slurs.json", "utf8")))

        const normalized = text
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .split(/\W+/)                // tokenizacja słów

        console.log(normalized);
        console.log(slurs);

        return normalized.some(w => slurs.has(w))
    }

    private createErrorEmbed = (desc: string) => {
        return new EmbedBuilder()
            .setDescription(desc)
            .setColor(0xED4245)
            .setImage('https://i1.sndcdn.com/artworks-nMoQsjqeYcqOfAnl-iDszCQ-t500x500.jpg')
    }

    private createContentEmbed = (desc: string) => {
        return new EmbedBuilder()
            .setDescription(desc)
            .setColor("#2ec9dc")
    }

    public getChannels= async (guildId?: string) => {
        if(!guildId) {
            throw new Error("Missing guildId");
        }

        const guild = await this.getGuild(guildId)

        return guild.channels.fetch();
    }

    public getGuilds = async () => {
        return this._client.guilds.fetch()
    }

    public getGuild = async (guildId?: string) => {
        if(!guildId) {
            throw new Error("Missing guildId");
        }

        return this._client.guilds.fetch(guildId)
    }

    public getUser = async (guildId?: string, userId?: string) => {
        if(!guildId) {
            throw new Error("Missing guildId");
        }

        if(!userId) {
            throw new Error("Missing userId");
        }

        const guild = await this._client.guilds.fetch(guildId);
        return guild.members.fetch(userId);
    }

    public getUsers = async (guildId?: string) => {
        if(!guildId) {
            throw new Error("Missing guildId");
        }
        const guild = await this._client.guilds.fetch(guildId);
        return guild.members.fetch();
    }
}