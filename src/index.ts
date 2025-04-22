import dotenv from "dotenv";
import express from 'express'
import {DiscordAdapter} from "./client";

dotenv.config()


const main = async () => {
    const app = express();
    const discordAdapter = new DiscordAdapter(process.env.KRTEK_DC_TOKEN);
    await discordAdapter.login()

    const channels = await discordAdapter.getChannels(process.env.FBI_ID);
    const mapped = channels?.map((guild) => ({ name: guild?.name, id: guild?.id }));
    console.log(mapped);

    app.use(express.json());

    app.get('/user', async (req, res) => {
        const user = await discordAdapter.getUsers()
        res.send({ users: user})
    })

    app.listen(process.env.PORT, () => {
        console.log(`Listening on port ${process.env.PORT}`)
    });
}

main();
