import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Message,
  OmitPartialGroupDMChannel,
  VoiceBasedChannel,
  VoiceState,
  // @ts-ignore
} from "discord.js";
import fs from "node:fs/promises";
import {
  AudioReceiveStream,
  EndBehaviorType,
  joinVoiceChannel,
  VoiceConnection,
  VoiceReceiver,
} from "@discordjs/voice";
import { OpusEncoder } from "@discordjs/opus";
import { createWriteStream } from "node:fs";
import * as path from "node:path";
import { WhisperBridge } from "./whisper.bridge";

export class DiscordAdapter {
  private _client: Client;
  private config: { CLIENT_ID?: string; CLIENT_TOKEN?: string };
  private connection?: VoiceConnection | null;
  private receiverListening: boolean = false;
  private nicoUID: string;
  private streams: Map<string, AudioReceiveStream> = new Map();
  private whisperBridge;

  constructor(private token?: string) {
    this.config = {
      CLIENT_ID: process.env.CLIENT_ID,
      CLIENT_TOKEN: this.token,
    };

    this.whisperBridge = new WhisperBridge(process.env.MODEL ?? "base");

    this.nicoUID = process.env.CZECHOPOLAK_ID ?? "";

    this._client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
  }

  public login = async () => {
    // @ts-ignore
    this._client.on(Events.ClientReady, async (ct) => {
      console.log(ct.user.tag);
    });

    this._client.on(Events.MessageCreate, this.onSlur);
    this._client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (newState?.member?.user.bot) {
        return;
      }

      this.onChannelJoined(oldState, newState);
      this.onChannelLeft(oldState, newState);
    });

    await this._client.login(this.config.CLIENT_TOKEN);
  };

  public onChannelJoined = async (
    oldState: VoiceState,
    newState: VoiceState,
  ) => {
    if (oldState.channelId || !newState.channelId) {
      return;
    }

    if (!newState?.channel?.isVoiceBased()) {
      return;
    }

    if (!this.connection) {
      this.connection = this.joinVoice(newState.channel);

      if (this.receiverListening) {
        return;
      }

      this.receiverListening = true;
      const receiver = this.connection.receiver;
      receiver.speaking.on("start", (userId) =>
        this.onUserSpeak(userId, receiver),
      );
    }

    console.log(
      `${newState?.member?.user.tag} wszedł na ${newState.channel?.name}`,
    );
  };

  private onUserSpeak = async (uid: string, receiver: VoiceReceiver) => {
    if (this.streams.has(uid)) {
      return;
    }

    const decoder = new OpusEncoder(48000, 2);
    const dir = `./data/recordings/`;
    const file = `${uid}.pcm`;
    const filename = path.join(dir, file);

    const opus = receiver.subscribe(uid, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
    });

    this.streams.set(uid, opus);
    const out = createWriteStream(filename);

    opus.on("data", (chunk) => {
      out.write(decoder.decode(chunk));
    });

    opus.on("end", async () => {
      const processDir = `./data/processing/`;
      const processFilename = path.join(
        processDir,
        file.replace(".pcm", `.${Date.now()}.pcm`),
      );

      out.end();
      await fs.copyFile(filename, processFilename);
      try {
        await this.whisperBridge.transcribe(
          processFilename,
          (filename: string) => {
            fs.rm(filename);
          },
          (text) => this.onVoiceSlur(uid, text),
          (text) => this.onLog(uid, text),
        );
      } catch (e) {
        console.error(e);
      }

      this.streams.delete(uid);
    });
  };

  private onUserLeft = (oldState: VoiceState, newState: VoiceState) => {
    const uid = oldState.member?.user.id;

    if (!uid) {
      return;
    }

    this.streams.delete(uid);
    console.log(
      `${oldState?.member?.user.tag} wyszedł z ${oldState.channel?.name}`,
    );
  };

  public onChannelLeft = (oldState: VoiceState, newState: VoiceState) => {
    if (!oldState.channelId || newState.channelId) {
      return;
    }

    this.onUserLeft(oldState, newState);

    if (oldState?.channel?.members.size !== 1) {
      return;
    }

    if (!oldState?.channel?.isVoiceBased()) {
      return;
    }

    if (!this.connection) {
      return;
    }

    this.connection.destroy();
    this.connection = null;
    this.streams.clear();

    console.log(`Wszyscy wyszli z ${oldState.channel?.name}`);
  };

  public joinVoice = (channel: VoiceBasedChannel) =>
    joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

  public onSlur = async (msg: OmitPartialGroupDMChannel<Message<boolean>>) => {
    if (!(await this.testContentForSlurs(msg.content))) {
      return;
    }

    if (msg.author.bot) {
      return;
    }

    const guildId = process.env.FBI_ID;
    const targetUserId = process.env.CZECHOPOLAK_ID;
    const generalChannelId = process.env.GENERAL_CHANNEL_ID ?? "";

    const activeUser = await this.getUser(guildId, targetUserId);
    const channel = await this._client.channels.fetch(generalChannelId);

    if (channel?.isSendable()) {
      channel.send({
        embeds: [
          this.createErrorEmbed(`❌ Chomik bluzga po raz kolejny`),
          this.createContentEmbed(
            `@${msg.author.tag} powiedział:  ${msg.content}`,
          ),
        ],
      });
    }
  };

  public onVoiceSlur = async (user: string, text: string) => {
    if (!(await this.testContentForSlurs(text))) {
      return;
    }

    const guildId = process.env.FBI_ID;
    const targetUserId = process.env.CZECHOPOLAK_ID;
    const generalChannelId = process.env.GENERAL_CHANNEL_ID ?? "";

    const channel = await this._client.channels.fetch(generalChannelId);

    if (!channel?.isSendable()) {
      return;
    }

    channel.send({
      embeds: [
        this.createErrorEmbed(`❌ Chomik bluzga po raz kolejny`),
        this.createContentEmbed(`<@${user}> powiedział:  ${text}`),
      ],
    });
  };

  public onLog = async (user: string, text: string) => {
    if (!text || text.replace(/\s+/g, "") == "") {
      return;
    }

    const generalChannelId = process.env.LOG_CHANNEL_ID ?? "";

    const channel = await this._client.channels.fetch(generalChannelId);

    if (!channel?.isSendable()) {
      return;
    }

    channel.send({
      embeds: [this.createContentEmbed(`<@${user}> powiedział:  ${text}`)],
    });
  };

  private testContentForSlurs = async (text: string): Promise<boolean> => {
    const slurs = new Set(
      JSON.parse(await fs.readFile("./data/slurs.json", "utf8")),
    );

    const normalized = text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\W+/); // tokenizacja słów

    return normalized.some((w) => slurs.has(w));
  };

  private createErrorEmbed = (desc: string) => {
    return new EmbedBuilder()
      .setDescription(desc)
      .setColor(0xed4245)
      .setImage(
        "https://i1.sndcdn.com/artworks-nMoQsjqeYcqOfAnl-iDszCQ-t500x500.jpg",
      );
  };

  private createContentEmbed = (desc: string) => {
    return new EmbedBuilder().setDescription(desc).setColor("#2ec9dc");
  };

  public getChannels = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    const guild = await this.getGuild(guildId);

    return guild.channels.fetch();
  };

  public getGuilds = async () => {
    return this._client.guilds.fetch();
  };

  public getGuild = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    return this._client.guilds.fetch(guildId);
  };

  public getUser = async (guildId?: string, userId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }

    if (!userId) {
      throw new Error("Missing userId");
    }

    const guild = await this._client.guilds.fetch(guildId);
    return guild.members.fetch(userId);
  };

  public getUsers = async (guildId?: string) => {
    if (!guildId) {
      throw new Error("Missing guildId");
    }
    const guild = await this._client.guilds.fetch(guildId);
    return guild.members.fetch();
  };
}
